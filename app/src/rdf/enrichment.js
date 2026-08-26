import { Parser, DataFactory } from 'n3';

const { namedNode, quad } = DataFactory;

export const ENRICHMENT_GRAPH = 'urn:d3fend-graph:enrichment:well-known-auth';

/** Parses a turtle string into quads tagged with the enrichment named graph. */
export function loadEnrichmentTurtle(ttlText) {
  const parser = new Parser({ baseIRI: ENRICHMENT_GRAPH });
  const quads = parser.parse(ttlText);
  const graph = namedNode(ENRICHMENT_GRAPH);
  return quads.map((q) => quad(q.subject, q.predicate, q.object, graph));
}
