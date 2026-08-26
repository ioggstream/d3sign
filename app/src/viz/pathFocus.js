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
 * Returns `{ nodeIds, edgeIds }` as Sets.
 */
export function directionalFlow(nodes, edges, startId, direction) {
  const nodeIds = new Set(nodes);
  if (!nodeIds.has(startId)) return { nodeIds: new Set(), edgeIds: new Set() };

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

  while (queue.length) {
    const id = queue.shift();
    const nextEdges = useIncoming ? (incoming.get(id) ?? []) : (outgoing.get(id) ?? []);
    for (const [edge, nextId] of nextEdges) {
      reachableEdges.add(edge.id);
      if (reachableNodes.has(nextId)) continue;
      reachableNodes.add(nextId);
      queue.push(nextId);
    }
  }

  return { nodeIds: reachableNodes, edgeIds: reachableEdges };
}
