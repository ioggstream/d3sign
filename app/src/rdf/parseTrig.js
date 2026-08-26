import { Parser, DataFactory } from 'n3';

const { namedNode, quad } = DataFactory;

/**
 * Where triples written outside any `G:name { … }` block end up. The TriG pane
 * shows every named graph, so text at the top level is RDF the user typed
 * without saying where it belongs.
 */
export const MANUAL_GRAPH = 'urn:d3fend-graph:manual';

/**
 * Parses the TriG text of the whole document back into per-graph quads — the
 * reverse of serialize.js, which already writes named graphs as TriG blocks.
 *
 * Returns `{ graphs, error }` and never throws: a half-typed document is the
 * normal state of an editor, and the caller keeps the last valid graphs when
 * `error` is set.
 */
export function parseTrigText(text) {
  let parsed;
  try {
    parsed = new Parser({ baseIRI: MANUAL_GRAPH }).parse(text);
  } catch (error) {
    return { graphs: new Map(), error };
  }

  const graphs = new Map();
  for (const q of parsed) {
    // The default graph is a blank-node-typed term with an empty value in n3.
    const name = q.graph?.value || MANUAL_GRAPH;
    if (!graphs.has(name)) graphs.set(name, []);
    graphs.get(name).push(q.graph?.value ? q : quad(q.subject, q.predicate, q.object, namedNode(name)));
  }
  return { graphs, error: null };
}
