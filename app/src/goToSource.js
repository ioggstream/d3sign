import { edgeKey } from './editor/sourceLocations.js';
import { PREFIXES } from './rdf/emit.js';
import { displayIdOf } from './rdf/graphModel.js';

/**
 * The bridge from what the graph draws back to what the mermaid source says.
 *
 * It lives in the app shell rather than in the view because the view is not
 * allowed to know mermaid exists: everything downstream of the RDF store is
 * built from the store alone (docs/adr/0014-graph-view-from-rdf-only.md). So
 * instead of carrying provenance forward, the shell reverses the identifiers on
 * demand and asks the editor to look them up.
 */

/**
 * The mermaid id behind a graph node, or null when the node has no mermaid
 * origin — an enrichment resource, an IRI hand-written in the TriG pane, or a
 * d3f: class.
 *
 * `PREFIXES.E` starts with `PREFIXES.G`, and `displayIdOf` strips whichever it
 * matches first, so enrichment has to be excluded before the graph-local test
 * or `enrichment:foo` gets looked up as if someone had typed it.
 */
export function mermaidIdOf(iri) {
  if (typeof iri !== 'string') return null;
  if (!iri.startsWith(PREFIXES.G) || iri.startsWith(PREFIXES.E)) return null;
  return displayIdOf(iri);
}

/**
 * The written triples a drawn edge stands for, as `sourceLocations.edgeKey`
 * strings. Usually one; several when a fold has collapsed a group of links into
 * a single element.
 *
 * A cytoscape edge is not the edge that was typed. Three transforms sit in
 * between (viz/toCytoscape.js):
 *
 *  - flipping a predicate in the Links filter swaps the endpoints, so the same
 *    relation is drawn backwards. `filterState.direction` is per-predicate and
 *    global, which is what makes it undoable here;
 *  - folding re-anchors an endpoint onto a visible ancestor. `data.derived`
 *    marks that, and the endpoints as asserted survive in `foldedFrom`/`foldedTo`;
 *  - collapsing an artifact-mediated path replaces two links with one arrow whose
 *    predicate is synthetic, so there is nothing to reverse and nothing to look
 *    up — `standsFor` holds both written triples outright.
 *
 * `data.predicate` needs no undoing: it is always the CURIE as written, never
 * the inverse label, which is only ever used for display.
 */
export function writtenTriplesOf(data, filterState) {
  if (!data?.predicate) return [];
  // A collapsed path knows its triples exactly, and `direction` never applied to
  // it (its predicate is not one anybody can flip), so `standsFor` *is* the written
  // form. Both legs are real mermaid arrows, so repeated `g` walks between them.
  if (data.collapsed) {
    const keys = new Set();
    for (const triple of data.standsFor || []) {
      const from = mermaidIdOf(triple.from);
      const to = mermaidIdOf(triple.to);
      if (from && to) keys.add(edgeKey(from, triple.predicate, to));
    }
    return [...keys];
  }
  const flipped =
    Boolean(data.invertible) && filterState?.direction?.get(data.predicate) === 'inverse';
  const drawnFrom = data.derived ? data.foldedFrom || [] : [data.source];
  const drawnTo = data.derived ? data.foldedTo || [] : [data.target];
  const [fromIris, toIris] = flipped ? [drawnTo, drawnFrom] : [drawnFrom, drawnTo];

  const keys = new Set();
  const collect = (sources, targets) => {
    for (const fromIri of sources) {
      const from = mermaidIdOf(fromIri);
      if (!from) continue;
      for (const toIri of targets) {
        const to = mermaidIdOf(toIri);
        // `foldedFrom`/`foldedTo` are the group's endpoints, not its pairs, so
        // this cross product can name a link nobody wrote. Those simply resolve
        // to no location and drop out.
        if (to) keys.add(edgeKey(from, data.predicate, to));
      }
    }
  };
  collect(fromIris, toIris);
  // A two-way link is one element standing for the relation asserted each way,
  // so the triple written back-to-front is one of the ones it came from.
  if (data.bidirectional) collect(toIris, fromIris);
  return [...keys];
}
