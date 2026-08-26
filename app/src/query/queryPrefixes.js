/**
 * The prefix set a SPARQL query is written against: the document prefixes, the
 * two query-layer graph prefixes, and whatever each loaded knowledge base
 * declares.
 *
 * These are deliberately *not* in `PREFIXES` (app/src/rdf/emit.js): that set is
 * handed to n3's Writer, which emits every entry whether used or not, so putting
 * K:/Q: there would rewrite the TriG pane's header and all 14 snapshots for
 * prefixes no document graph ever uses.
 */

import { PREFIXES } from '../rdf/emit.js';
import { KG_GRAPH_PREFIX } from '../rdf/knowledgeBases.js';

/**
 * Query-layer prefixes, on top of the document's. `xsd:` is here rather than in
 * the document set for the same reason as K:/Q: — no diagram triple needs it, but
 * a query filtering or casting a literal does, and it keeps datatyped literals
 * readable in the results table.
 *
 * Every vocabulary a knowledge base is written in is here too, and unconditionally:
 * a query naming only `K:regulation` still has to be able to write `dpv:`, and
 * `queryPrefixes` below merges a knowledge base's own declarations only once that
 * base is *loaded*. Declaring them per entry would mean the same query parses or
 * fails depending on which checkboxes happen to be ticked.
 */
export const QUERY_GRAPH_PREFIXES = {
  K: KG_GRAPH_PREFIX,
  Q: 'urn:d3fend-graph:query:',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  // The D3FEND ontology's own vocabularies beyond d3f:/rdfs: (see PREFIXES).
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dct: 'http://purl.org/dc/terms/',
  // W3C DPV 2.3 and the EU legal extensions it publishes (K:legal). The labels are
  // upstream's own — `legal.ttl.gz` declares `eu-gdpr:`, not `gdpr:` — so a term
  // copy-pasted out of the DPV documentation resolves here without translation.
  // `-` is legal in a Turtle/SPARQL PN_PREFIX, which is why DPV can use it.
  //
  // Do not add `gdpr:` back as an alias: the hover/completion token pattern anchors a
  // prefix on a non-word character, and `-` is one, so `eu-gdpr:X` would match twice —
  // once whole, once as a phantom `gdpr:X`.
  dpv: 'https://w3id.org/dpv#',
  pd: 'https://w3id.org/dpv/pd#',
  risk: 'https://w3id.org/dpv/risk#',
  tech: 'https://w3id.org/dpv/tech#',
  'eu-gdpr': 'https://w3id.org/dpv/legal/eu/gdpr#',
  'eu-nis2': 'https://w3id.org/dpv/legal/eu/nis2#',
  'eu-aiact': 'https://w3id.org/dpv/legal/eu/aiact#',
  // Hand-authored, this app's own: the obligation catalogue and the mappings that
  // tie d3f: classes to it (K:regulation).
  ob: 'urn:d3fend-graph:obl:',
  al: 'urn:d3fend-graph:align:',
};

/**
 * Builds the effective prefix map for a set of loaded knowledge bases. Later
 * sources win, but a knowledge base redefining `d3f:` to something else would be
 * a bug in its manifest entry, not a case to support.
 */
export function queryPrefixes(loadedKbs = []) {
  const prefixes = { ...PREFIXES, ...QUERY_GRAPH_PREFIXES };
  for (const kb of loadedKbs) Object.assign(prefixes, kb.prefixes || {});
  return prefixes;
}

/**
 * The `PREFIX` block prepended to every query, so nobody types declarations.
 *
 * SPARQL 1.1 lets a later declaration of the same label override an earlier one,
 * so a user who declares `d3f:` themselves still wins. The cost is that the
 * engine's error line numbers count from the top of the *sent* text — see
 * `adjustErrorPosition` in resultModel.js.
 */
export function prefixPreamble(prefixes) {
  return Object.entries(prefixes)
    .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
    .join('\n');
}

/** How many lines `prefixPreamble` adds ahead of the user's first line. */
export function preambleLineCount(prefixes) {
  return Object.keys(prefixes).length + 1; // one blank separator line
}

export function withPreamble(sparql, prefixes) {
  return `${prefixPreamble(prefixes)}\n\n${sparql}`;
}
