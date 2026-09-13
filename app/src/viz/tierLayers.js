/**
 * Which tier each drawn node belongs to, so a multi-tier architecture draws as tiers.
 *
 * `nodes` is an iterable of `{ id, isParent, parentId }` and `edges` an iterable of
 * `{ id, source, target, kind, bidirectional }`, both from the *currently drawn* graph —
 * the same plain records viz/pathFocus.js takes, extracted from cytoscape by the caller.
 * Nothing here is imported from the RDF layer (ADR 0014): a link kind rides on the element
 * as a string, which is how viz/graphStyle.js already reads it.
 *
 * A tier is decided by the links something actually travels along, and by nothing else.
 * `d3f:copy-of` between a database and its standby replica says the two are the same
 * thing, not that one comes after the other, so a drawing that layers on it puts the
 * standby in a tier of its own — and, under a layout that reads direction, in the *first*
 * one, since its only links point outwards. Restricting the layering input to the flow
 * kinds is what fixes that; the link is still drawn, it just no longer decides a column.
 *
 * Four rules, each with a failure it exists to prevent:
 *
 * 1. **Longest path, not hop count.** A `user d3f:accesses db` shortcut alongside
 *    `user → fe → be → db` must not pull the database into tier 1: a tier is how far a
 *    thing can be from the front, not how close.
 * 2. **A cycle is one tier.** Two services that call each other have no order between
 *    them, and a walk that picked one would depend on which edge it saw first. They are
 *    condensed (Tarjan) and share a tier.
 * 3. **A node with no flow link inherits one.** The standby is placed beside what it is
 *    attached to, over any kind of link, rather than being left at the front.
 * 4. **Nothing is drawn before the root.** With a flow root the tiers are shifted so it
 *    sits at 0 and anything upstream of it is clamped there — the same statement
 *    `elk.layered.layering.layerConstraint: FIRST` makes today.
 */

/**
 * The kinds a tier is computed over: the two that mean something moves or is invoked.
 * `connectivity`, `location`, `tactical-verb`, `privacy` and `other` are drawn and say
 * nothing about order. Exported because viz/graphPane.js must hand ELK the same subset.
 */
export const TIER_FLOW_KINDS = ['data-flow', 'control-flow'];

/** Adjacency as `Map<id, id[]>`, built once and read in both directions. */
function adjacency(ids, edges, { bothWays }) {
  const out = new Map([...ids].map((id) => [id, []]));
  const into = new Map([...ids].map((id) => [id, []]));
  for (const edge of edges) {
    const { source, target } = edge;
    // A self-loop is not a step, and an edge with an end that is not drawn — one anchored
    // on a folded container's hidden child — has no tier to state.
    if (source === target || !out.has(source) || !out.has(target)) continue;
    out.get(source).push(target);
    into.get(target).push(source);
    if (bothWays && edge.bidirectional) {
      out.get(target).push(source);
      into.get(source).push(target);
    }
  }
  return { out, into };
}

/**
 * Strongly connected components, in reverse topological order of the condensation — a
 * sink comes out first, which is Tarjan's own order. Iterative rather than recursive: the
 * drawn graph is user-scale, but a stack overflow on a large import would be a crash
 * rather than a poor drawing.
 */
function stronglyConnectedComponents(ids, out) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let next = 0;

  for (const start of ids) {
    if (index.has(start)) continue;
    // Each frame is `[node, i]`: the node being visited and how far through its successors
    // the walk has got.
    const frames = [[start, 0]];
    index.set(start, next);
    low.set(start, next);
    next += 1;
    stack.push(start);
    onStack.add(start);

    while (frames.length) {
      const frame = frames[frames.length - 1];
      const [node] = frame;
      const successors = out.get(node) ?? [];
      if (frame[1] < successors.length) {
        const successor = successors[frame[1]];
        frame[1] += 1;
        if (!index.has(successor)) {
          index.set(successor, next);
          low.set(successor, next);
          next += 1;
          stack.push(successor);
          onStack.add(successor);
          frames.push([successor, 0]);
        } else if (onStack.has(successor)) {
          low.set(node, Math.min(low.get(node), index.get(successor)));
        }
        continue;
      }

      frames.pop();
      if (frames.length) {
        const [parent] = frames[frames.length - 1];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === index.get(node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== node);
        components.push(component);
      }
    }
  }
  return components;
}

/**
 * The tier of every node a flow link touches: the longest path to it through the
 * condensation, counted in components rather than in nodes so a cycle costs one step.
 *
 * Only those nodes. A node with no flow link of its own would otherwise come out of the
 * walk as a component at tier 0 — indistinguishable from a genuine source, and never
 * offered to the inheritance pass that exists to place it.
 */
function flowTiers(nodeIds, flowEdges) {
  const ids = new Set();
  for (const edge of flowEdges) {
    if (edge.source === edge.target) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    ids.add(edge.source);
    ids.add(edge.target);
  }
  const { out } = adjacency(ids, flowEdges, { bothWays: false });
  // Tarjan emits sinks first, so the reverse is a topological order and every predecessor
  // of a component is settled before the component is read.
  const components = stronglyConnectedComponents(ids, out).reverse();

  const componentOf = new Map();
  components.forEach((component, i) => {
    for (const id of component) componentOf.set(id, i);
  });

  const tierOf = new Array(components.length).fill(0);
  components.forEach((component, i) => {
    for (const id of component) {
      for (const successor of out.get(id) ?? []) {
        const j = componentOf.get(successor);
        // Its own component is the cycle itself, which costs nothing.
        if (j !== i) tierOf[j] = Math.max(tierOf[j], tierOf[i] + 1);
      }
    }
  });

  const tiers = new Map();
  for (const id of ids) {
    const component = componentOf.get(id);
    if (component !== undefined) tiers.set(id, tierOf[component]);
  }
  return tiers;
}

/**
 * Gives every node left without a tier the one of its nearest tiered neighbour, over links
 * of any kind and in either direction — a standby replica sits beside the database it
 * copies whatever predicate joins them.
 *
 * Distance first, then the lower tier: a node between two tiers belongs to the earlier
 * one, so a drawing never claims a thing happens later than the evidence says. A node no
 * link reaches falls to 0, which is where an isolated node is drawn anyway.
 */
function inheritTiers(ids, edges, tiers) {
  const { out, into } = adjacency(ids, edges, { bothWays: true });
  // Sorted so a run over a Set — whose order is insertion order — cannot make the result
  // depend on the order the elements happened to arrive in.
  let frontier = [...tiers.keys()].sort();

  while (frontier.length) {
    const candidates = new Map();
    for (const id of frontier) {
      const tier = tiers.get(id);
      for (const neighbour of [...(out.get(id) ?? []), ...(into.get(id) ?? [])]) {
        if (tiers.has(neighbour)) continue;
        const best = candidates.get(neighbour);
        if (best === undefined || tier < best) candidates.set(neighbour, tier);
      }
    }
    // Written after the whole frontier is read, so every node at this distance is settled
    // against the same set — a node reached twice takes the lower tier, not the first one.
    for (const [id, tier] of candidates) tiers.set(id, tier);
    frontier = [...candidates.keys()].sort();
  }

  for (const id of ids) {
    if (!tiers.has(id)) tiers.set(id, 0);
  }
  return tiers;
}

/**
 * A container spans the tiers of what it holds, and takes the first of them. It must take
 * one: ELK's partitioning places an unpartitioned node wherever its edges lead, and one
 * such node in a partitioned graph moves the nodes around it out of their tiers
 * (app/test/elk-partitioning.test.js characterises this).
 */
function foldParents(nodes, tiers, flow) {
  const parentOf = new Map();
  for (const node of nodes) {
    if (node.parentId) parentOf.set(node.id, node.parentId);
  }

  // A container's *own* inherited tier says nothing — it was read off a neighbour of the
  // box rather than of its contents — so it is replaced outright. A flow link the
  // container itself states is kept, being a fact about the box.
  const folded = new Map();
  for (const node of nodes) {
    const tier = tiers.get(node.id);
    const seen = new Set([node.id]);
    let ancestor = parentOf.get(node.id);
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor);
      const best = folded.get(ancestor);
      folded.set(ancestor, best === undefined ? tier : Math.min(best, tier));
      ancestor = parentOf.get(ancestor);
    }
  }

  for (const [id, tier] of folded) {
    const own = flow.get(id);
    tiers.set(id, own === undefined ? tier : Math.min(own, tier));
  }
  return tiers;
}

/**
 * `Map<node id, tier>` covering every node given, tiers starting at 0.
 *
 * `rootId` is the node the reading starts from (viz/graphPane.js): the tiers are shifted so
 * it sits at 0, and whatever the flow puts before it is clamped there rather than drawn
 * ahead of it.
 */
export function tierLayers(nodes, edges, { rootId = null } = {}) {
  const records = [...nodes];
  const ids = records.map((node) => node.id);
  const idSet = new Set(ids);
  const drawnEdges = [...edges];
  const flowEdges = drawnEdges.filter((edge) => TIER_FLOW_KINDS.includes(edge.kind));

  const flow = flowTiers(idSet, flowEdges);
  const tiers = foldParents(records, inheritTiers(idSet, drawnEdges, new Map(flow)), flow);

  const offset = rootId !== null && tiers.has(rootId) ? tiers.get(rootId) : 0;
  if (offset !== 0) {
    for (const [id, tier] of tiers) tiers.set(id, Math.max(0, tier - offset));
  }
  return tiers;
}

/**
 * The nodes cytoscape's `breadthfirst` layout should start its walk from.
 *
 * Cytoscape defaults to every node with no incoming edge, and collects whatever its walk
 * never reaches into a *new row above the first one* — so a node whose links all point
 * backwards ends up drawn ahead of the node the user asked to start from. Naming the roots
 * puts that node in the first row instead of above it.
 *
 * The walk is directed and follows an edge as drawn, which is what cytoscape does with the
 * single element a two-way relation is merged into. Extra roots are added until every node
 * is reachable, preferring the ones cytoscape would have chosen by itself.
 *
 * Returns `null` when there is nothing to say, so the caller can leave the option off
 * rather than pass an empty list, which cytoscape would read as "no roots at all".
 */
export function layoutRoots(nodes, edges, rootId = null) {
  const ids = [...nodes].map((node) => node.id);
  const idSet = new Set(ids);
  if (!idSet.size) return null;

  const { out, into } = adjacency(idSet, edges, { bothWays: false });
  const roots = [];
  const reached = new Set();

  const reach = (start) => {
    if (reached.has(start)) return;
    roots.push(start);
    const queue = [start];
    reached.add(start);
    while (queue.length) {
      for (const next of out.get(queue.shift()) ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
  };

  if (rootId !== null && idSet.has(rootId)) reach(rootId);
  // Cytoscape's own choice, so a graph the default already handled is laid out as before.
  const sources = ids.filter((id) => (into.get(id) ?? []).length === 0).sort();
  for (const id of sources) reach(id);
  // Whatever is left is a cycle nothing points into, or a node reachable only backwards.
  for (const id of [...ids].sort()) reach(id);

  return roots.length ? roots : null;
}
