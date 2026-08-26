import { Writer } from 'n3';
import { PREFIXES } from './emit.js';

/**
 * The prefixes the TriG pane has always declared, whether a document uses them or
 * not: D3FEND, the RDF built-ins, and this app's own two namespaces.
 *
 * Kept unconditional so admitting the DPV namespaces to PREFIXES changes no
 * existing output. `E:` in particular is used by only the enrichment graphs, and
 * dropping it from every other document's header would rewrite all 14 snapshots
 * for no gain — the churn ADR 0025 refused, arriving by the back door.
 */
const ALWAYS_DECLARED = new Set(['d3f', 'rdf', 'rdfs', 'G', 'E']);

/**
 * PREFIXES, minus the namespaces no IRI in `quads` lives in.
 *
 * n3's Writer emits every prefix it is handed, used or not. That is why ADR 0025
 * kept `ob:`/`al:` out of PREFIXES altogether and why the DPV namespaces could not
 * simply be added: a diagram mentioning none of them would still declare all five.
 * Narrowing the *new* entries — and only those, see ALWAYS_DECLARED — admits them
 * at zero cost to any document that does not write one.
 */
function usedPrefixes(quads) {
  const inUse = (namespace) =>
    quads.some((quad) =>
      [quad.subject, quad.predicate, quad.object, quad.graph].some(
        (term) => term?.termType === 'NamedNode' && term.value.startsWith(namespace),
      ),
    );
  return Object.fromEntries(
    Object.entries(PREFIXES).filter(
      ([prefix, namespace]) => ALWAYS_DECLARED.has(prefix) || inUse(namespace),
    ),
  );
}

/** Serializes an array (or store subset) of quads to a turtle string. */
export function toTurtle(quads) {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ prefixes: usedPrefixes(quads), format: 'text/turtle' });
    writer.addQuads(quads);
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

/**
 * Serializes quads as N-Quads — no prefixes, one self-contained line per quad,
 * graph included.
 *
 * This is the hand-off to the query engine (app/src/query/queryClient.js): the
 * format needs no prefix bookkeeping on either side, and every quad carries its
 * own graph, so a whole batch loads in one call.
 */
export function toNQuads(quads) {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: 'application/n-quads' });
    writer.addQuads(quads);
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}
