import { describe, it, expect } from 'vitest';
import { separateSiblings } from '../src/viz/separateSiblings.js';

const box = (id, x1, y1, x2, y2) => ({ id, x1, y1, x2, y2 });

/** The boxes as the pane would draw them, with the returned shifts applied. */
const settle = (boxes, minGap, maxIterations) => {
  const shifts = separateSiblings(boxes, minGap, maxIterations);
  return boxes.map((b) => {
    const { dx, dy } = shifts.get(b.id) ?? { dx: 0, dy: 0 };
    return { ...b, x1: b.x1 + dx, x2: b.x2 + dx, y1: b.y1 + dy, y2: b.y2 + dy };
  });
};

const find = (boxes, id) => boxes.find((b) => b.id === id);

/** How far two boxes are apart; negative means they intersect. */
const gapBetween = (a, b) => Math.max(
  Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2),
  Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2),
);

/** Asserts the invariant on every pair: no two boxes closer than `minGap`. */
const expectSeparated = (boxes, minGap) => {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      expect(gapBetween(boxes[i], boxes[j]), `${boxes[i].id} vs ${boxes[j].id}`)
        .toBeGreaterThanOrEqual(minGap);
    }
  }
};

describe('separateSiblings', () => {
  it('leaves boxes that already clear each other alone', () => {
    expect(separateSiblings([box('a', 0, 0, 10, 10), box('container', 40, 0, 140, 100)], 8).size).toBe(0);
  });

  it('reports no shift for a pair already a gap apart', () => {
    expect(separateSiblings([box('a', 0, 0, 10, 10), box('b', 18, 0, 28, 10)], 8).size).toBe(0);
  });

  it('pushes a node out of a container that does not contain it', () => {
    // The reported bug: `a` is not a child of `container`, so it must not be drawn
    // inside it. The way out is upwards here — 40px of container above `a` against
    // 90px to its right.
    const boxes = [box('container', 0, 0, 200, 100), box('a', 80, 40, 110, 70)];
    const settled = settle(boxes, 8);
    expectSeparated(settled, 8);
    expect(find(settled, 'a').x1).toBe(80);
  });

  it('takes the short way out for a node straddling a container border', () => {
    const boxes = [box('container', 0, 0, 200, 100), box('a', 180, 40, 240, 70)];
    const settled = settle(boxes, 8);
    expectSeparated(settled, 8);
    // Sideways, rather than down past the whole container.
    expect(find(settled, 'a').y1).toBe(40);
  });

  it('separates boxes that only touch', () => {
    expectSeparated(settle([box('a', 0, 0, 10, 10), box('b', 10, 0, 20, 10)], 8), 8);
  });

  it('splits the correction between the two boxes', () => {
    const shifts = separateSiblings([box('a', 0, 0, 10, 10), box('b', 6, 0, 16, 10)], 0);
    expect(shifts.get('a').dx).toBeLessThan(0);
    expect(shifts.get('b').dx).toBe(-shifts.get('a').dx);
    expect(shifts.get('a').dy).toBe(0);
  });

  it('clears a container a node covers completely', () => {
    expectSeparated(settle([box('container', 20, 20, 60, 60), box('wide', 0, 0, 200, 200)], 8), 8);
  });

  it('separates boxes drawn exactly on top of each other', () => {
    expectSeparated(settle([box('a', 0, 0, 30, 30), box('b', 0, 0, 30, 30)], 4), 4);
  });

  it('resolves an overlap it creates against a third box', () => {
    // Separating a from b pushes b into c, so a single pass is not enough.
    const boxes = [box('a', 0, 0, 40, 20), box('b', 30, 0, 70, 20), box('c', 75, 0, 115, 20)];
    expectSeparated(settle(boxes, 8), 8);
  });

  it('names only the boxes that have to move', () => {
    const boxes = [box('a', 0, 0, 10, 10), box('b', 5, 0, 15, 10), box('far', 500, 500, 510, 510)];
    expect([...separateSiblings(boxes, 0).keys()].sort()).toEqual(['a', 'b']);
  });

  it('gives up rather than looping forever', () => {
    // Three mutually overlapping boxes cannot settle in one pass; the point is that
    // it returns what it managed.
    const boxes = [box('a', 0, 0, 10, 10), box('b', 1, 1, 11, 11), box('c', 2, 2, 12, 12)];
    expect(separateSiblings(boxes, 4, 1).size).toBeGreaterThan(0);
  });

  it('has nothing to do below two boxes', () => {
    expect(separateSiblings([], 8).size).toBe(0);
    expect(separateSiblings([box('a', 0, 0, 10, 10)], 8).size).toBe(0);
  });
});
