/**
 * The knowledge bases the query engine can load.
 *
 * A knowledge base is the second tier of RDF in this app: large, read-only, and
 * queryable but never serialized to the TriG pane and never drawn in the graph
 * view (docs/adr/0020-sparql-query-engine.md). That is the whole reason it is not
 * a `graphContribution` — 130k ontology triples would land in a CodeMirror pane
 * and in Cytoscape, and neither survives it.
 *
 * Adding one is meant to be three steps and no code change beyond this file:
 *
 *   1. drop the turtle under app/public/kg/, gzipped;
 *   2. add an entry here;
 *   3. add .rq files under app/src/data/queries/ carrying `# needs: <id>`.
 *
 * If a fourth step turns out to be necessary, this design failed.
 *
 * Two rules the entries below follow, learned from adding the legal tier
 * (docs/adr/0025-legal-knowledge-bases.md):
 *
 *   - A hierarchy never crosses a named graph. A SPARQL property path is evaluated
 *     inside one GRAPH binding, so `skos:broader+` written inside a `GRAPH ?g`
 *     block over a vocabulary split across two graphs stops at the boundary and
 *     returns a shorter, plausible-looking answer. Outside any GRAPH block the
 *     path runs over the union of every loaded graph and does cross, but a
 *     canned query cannot rely on that: it is the queries that need `?g` to tell
 *     document triples from ontology ones that name a graph, and those are
 *     exactly the ones a split would break. Everything a path has to walk ships
 *     in one graph; links *between* graphs are one hop only.
 *   - Prefixes live in query/queryPrefixes.js, not on the entry. `prefixes` here is
 *     merged only when the base is loaded, which would make a query parse or fail
 *     depending on which checkboxes are ticked. It stays as an extension point for
 *     a base whose vocabulary is genuinely private to it; nothing uses it today.
 */

export const KG_GRAPH_PREFIX = 'urn:d3fend-graph:kg:';

/** The named graph a knowledge base's triples are loaded into. */
export function kgGraphName(id) {
  return `${KG_GRAPH_PREFIX}${id}`;
}

export const KNOWLEDGE_BASES = [
  {
    id: 'd3fend',
    label: 'D3FEND ontology',
    description: 'MITRE D3FEND OWL ontology: classes, hierarchy, and technique/artifact relations',
    graph: kgGraphName('d3fend'),
    // Relative to the app base, served from app/public/ verbatim by Vite, and
    // resolved against document.baseURI before it reaches the worker (a relative
    // fetch inside a worker resolves against the worker script's URL). Not an
    // import: a static import would bundle 3.6 MB into the JS and cost every
    // user, including the ones who never open the Query tab.
    //
    // Stored gzipped. Whether the *worker* has to inflate it is not declared here:
    // Vite serves `.gz` with `Content-Encoding: gzip` so the browser does it, while
    // a plain static host may not — so the loader sniffs the magic number instead
    // (query/queryWorker.js).
    url: 'kg/d3fend.ttl.gz',
    // Shown before the file is fetched, so the Sources chip can warn about the
    // cost. Replaced by the real count once loaded.
    tripleHint: 130000,
    missingHint:
      'Produce it with: gzip -9 -c /path/to/d3fend.ttl > app/public/kg/d3fend.ttl.gz',
  },
  {
    id: 'legal',
    label: 'EU legal vocabularies (DPV)',
    description:
      'W3C Data Privacy Vocabulary 2.3 and its EU extensions — GDPR, NIS2 and the AI Act — ' +
      'plus the dpv personal-data, risk and tech modules. ' +
      'Published by the W3C DPV CG under CC-BY-4.0.',
    graph: kgGraphName('legal'),
    url: 'kg/legal.ttl.gz',
    // Seven modules concatenated verbatim. One graph because the EU modules hang
    // their hierarchy off dpv:/risk: terms — see the note above about paths and
    // graph boundaries.
    //
    // Only a progress hint, so being stale costs a jumpy progress bar and nothing
    // else. `build-legal-kg.py --verify` prints the real count; this is the six-module
    // figure and is short by however many pd/pd.ttl adds.
    tripleHint: 31625,
    missingHint: 'Produce it with: python3 app/scripts/build-legal-kg.py --fetch',
  },
  {
    id: 'regulation',
    label: 'Obligations and D3FEND alignment',
    description:
      'Hand-authored: the obligations of NIS2 Art. 21(2) and GDPR Art. 32(1), and the mappings ' +
      'that tie D3FEND classes to them. Engineering judgement, not legal advice.',
    graph: kgGraphName('regulation'),
    // Plain turtle, not gzipped: it is hand-edited and small, and a mapping claim has
    // to be reviewable in a diff. The worker sniffs the gzip magic number rather than
    // trusting the extension, so both load (query/queryWorker.js).
    url: 'kg/regulation.ttl',
    tripleHint: 338,
  },
];

export function knowledgeBaseById(id) {
  return KNOWLEDGE_BASES.find((kb) => kb.id === id) || null;
}
