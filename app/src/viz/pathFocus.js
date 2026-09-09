/**
 * Reachability sets for a directional flow focus.
 *
 * `nodes` is an iterable of node ids, `edges` an iterable of
 * `{ id, source, target, bidirectional }` from the *currently drawn* graph.
 *
 * A `bidirectional` edge is one element standing for the relation asserted each
 * way (viz/toCytoscape.js), so it is walked in both directions: the flow must not
 * depend on which of the two triples happened to be drawn as the source end.
 *
 * `maxDepth` bounds the walk in hops, which is what lets the shell extend a focus
 * one hop per keypress (docs/adr/00032-improve-flow-discovery.md). A node at the
 * bound is reached but not expanded, so no edge is ever reported without both of
 * its ends: an edge drawn at full strength into a dimmed node would say the walk
 * goes somewhere it does not.
 *
 * Returns `{ nodeIds, edgeIds, depths, edgeDepths, truncated }`. `depths` maps a
 * node id to its hop count from `startId`, which is 0; `edgeDepths` maps an edge
 * id to the hop at which the walk crossed it, so a chain reads 1, 2, 3 along its
 * nodes and its links alike. `truncated` says the bound stopped the walk short of
 * something, which is the difference between "extended by a hop" and "this is the
 * whole flow" — reachability alone cannot tell those apart.
 */
export function directionalFlow(nodes, edges, startId, direction, { maxDepth = Infinity } = {}) {
  const nodeIds = new Set(nodes);
  if (!nodeIds.has(startId)) {
    return {
      nodeIds: new Set(),
      edgeIds: new Set(),
      depths: new Map(),
      edgeDepths: new Map(),
      truncated: false,
    };
  }

  // `[edge, otherEnd]` pairs, keyed by the end the walk arrives from.
  const outgoing = new Map();
  const incoming = new Map();
  const link = (map, from, edge, to) => {
    if (!map.has(from)) map.set(from, []);
    map.get(from).push([edge, to]);
  };
  for (const edge of edges) {
    link(outgoing, edge.source, edge, edge.target);
    link(incoming, edge.target, edge, edge.source);
    if (edge.bidirectional) {
      link(outgoing, edge.target, edge, edge.source);
      link(incoming, edge.source, edge, edge.target);
    }
  }

  const useIncoming = direction === 'incoming';
  const queue = [startId];
  const reachableNodes = new Set([startId]);
  const reachableEdges = new Set();
  const depths = new Map([[startId, 0]]);
  const edgeDepths = new Map();
  let truncated = false;

  while (queue.length) {
    const id = queue.shift();
    const depth = depths.get(id);
    // A node at the bound is the end of this walk. Whether anything lies beyond
    // it is what `truncated` reports, and it costs one lookup to find out.
    if (depth >= maxDepth) {
      const beyond = useIncoming ? incoming.get(id) : outgoing.get(id);
      if (beyond?.some(([, nextId]) => !reachableNodes.has(nextId))) truncated = true;
      continue;
    }

    const nextEdges = useIncoming ? (incoming.get(id) ?? []) : (outgoing.get(id) ?? []);
    for (const [edge, nextId] of nextEdges) {
      reachableEdges.add(edge.id);
      // The hop the walk crosses it at, first crossing winning. On a tree edge
      // that is the depth of the end it leads to; on an edge closing a cycle it
      // is not — `d3f` graphs have plenty of those, and banding such an edge with
      // its already-shallow target would put it next to the start of the walk
      // instead of where the reader met it.
      if (!edgeDepths.has(edge.id)) edgeDepths.set(edge.id, depth + 1);
      if (reachableNodes.has(nextId)) continue;
      reachableNodes.add(nextId);
      depths.set(nextId, depth + 1);
      queue.push(nextId);
    }
  }

  return { nodeIds: reachableNodes, edgeIds: reachableEdges, depths, edgeDepths, truncated };
}
