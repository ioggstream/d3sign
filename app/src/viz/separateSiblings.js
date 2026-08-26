/**
 * The one guarantee the layouts do not give: a node is never drawn inside, or
 * across the border of, a container that does not contain it.
 *
 * Cytoscape cannot express that constraint. A compound node has no position of
 * its own — `layoutPositions` drops parents outright and derives each container's
 * box from its children — so keeping a container clear of its neighbours is
 * something every layout has to model internally, and most do not: `grid`,
 * `circle`, `concentric` and `breadthfirst` filter parents out and place children
 * on a global grid, `cose` makes it a repulsive force that dense graphs overpower,
 * and even ELK only holds if what cytoscape renders matches what ELK was told
 * (see viz/layouts.js). So the invariant is restored afterwards instead of being
 * asked of the algorithm.
 *
 * Pure geometry, deliberately: `separateSiblings` knows nothing about cytoscape,
 * which is what lets it be tested in this repo — nothing here can instantiate a
 * renderer.
 */

/**
 * Overlap below this is left alone, in layout pixels.
 *
 * Relaxation converges on a chain of boxes rather than terminating: separating a
 * pair exactly can push one of them back into a third, and each round halves what
 * is left. Sub-pixel residue is not worth another pass over every pair — so the
 * pass aims a tolerance *past* the gap it was asked for, and stops once it is
 * within one. A settled result therefore honours `minGap` exactly.
 */
export const TOLERANCE = 0.5;

/**
 * How far `a` has to move along one axis to sit clear of `b`, and which way.
 *
 * Not the intersection of the two intervals: for a box nested inside another that
 * would be the inner box's own extent, which says nothing about how far it is from
 * getting out — and pushing by it leaves the box just as nested, one step further
 * along. This measures the two ways out and takes the shorter, so a node dropped
 * in the middle of a container leaves it in one move.
 *
 * @returns {{depth: number, direction: number}} `depth <= 0` when already clear.
 */
function escapeDepth(minA, maxA, minB, maxB, gap) {
  const forward = maxB + gap - minA; // move a to just past b
  const backward = maxA + gap - minB; // move a to just before b
  if (forward <= 0 || backward <= 0) return { depth: 0, direction: 0 };
  return forward <= backward
    ? { depth: forward, direction: 1 }
    : { depth: backward, direction: -1 };
}

/**
 * Shifts that leave no two of `boxes` closer than `minGap`.
 *
 * `boxes` are `{ id, x1, y1, x2, y2 }` in layout coordinates — for a container,
 * the box it is *drawn* as, children and labels included. Each overlapping pair is
 * pushed apart along the axis it is least deep into the other, half the distance
 * each: the smallest correction that clears them, and no reason to favour either
 * box. Repeated until nothing moves or `maxIterations` is spent, since one pair's
 * correction can push a box into a third.
 *
 * @returns {Map<string, {dx: number, dy: number}>} only the boxes that must move.
 */
export function separateSiblings(boxes, minGap = 0, maxIterations = 20) {
  const shifts = new Map();
  if (boxes.length < 2) return shifts;

  // Aimed a tolerance past the gap asked for, so that what the loop leaves behind
  // still clears it. See TOLERANCE.
  const gap = minGap + TOLERANCE;

  // Worked on locally, so a box pushed in one pair is seen displaced by the next.
  const current = boxes.map((box) => ({ ...box }));

  const move = (box, dx, dy) => {
    box.x1 += dx;
    box.x2 += dx;
    box.y1 += dy;
    box.y2 += dy;
    const total = shifts.get(box.id) ?? { dx: 0, dy: 0 };
    shifts.set(box.id, { dx: total.dx + dx, dy: total.dy + dy });
  };

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let moved = false;

    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        const a = current[i];
        const b = current[j];

        const x = escapeDepth(a.x1, a.x2, b.x1, b.x2, gap);
        const y = escapeDepth(a.y1, a.y2, b.y1, b.y2, gap);
        // Clear on either axis is clear, whatever the other one says — and within
        // a tolerance of clear is close enough on either.
        if (x.depth <= TOLERANCE || y.depth <= TOLERANCE) continue;

        moved = true;
        // `<=` settles the tie for boxes drawn exactly on top of each other,
        // where no axis and no direction is preferable to another.
        const step = x.depth <= y.depth
          ? { dx: (x.direction * x.depth) / 2, dy: 0 }
          : { dx: 0, dy: (y.direction * y.depth) / 2 };
        move(a, step.dx, step.dy);
        move(b, -step.dx, -step.dy);
      }
    }

    if (!moved) break;
  }

  for (const [id, shift] of shifts) {
    if (shift.dx === 0 && shift.dy === 0) shifts.delete(id);
  }
  return shifts;
}

/**
 * Every set of siblings in a compound hierarchy, deepest first.
 *
 * Separating siblings level by level from the bottom up is enough for the whole
 * drawing, because a container's box is the union of its children's boxes plus its
 * padding — so once no two siblings overlap at any level, two nodes in different
 * containers cannot overlap either. Deepest first because pushing children apart
 * grows the container around them, and the level above has to measure that.
 */
export function siblingLevels(cy) {
  const levels = [];

  // Breadth-first from the roots, so the levels come out shallowest first.
  let level = [cy.nodes().orphans()];
  while (level.length) {
    levels.push(level);
    level = level
      .flatMap((siblings) => siblings.map((node) => node.children()))
      .filter((children) => children.nonempty());
  }

  return levels.reverse().flat();
}
