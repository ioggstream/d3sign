# 20. SPARQL over the document and the D3FEND ontology

Date: 2026-08-07

## Status

Accepted

## Context

Ontology questions were answered from three
precomputed JSON projections —
`d3fend-categories.json`,
`d3fend-completions.json` and
`d3fend-metadata.json`, 4.4 MB in the bundle, built
by [app/scripts/](../../app/scripts/) from a
`d3fend.ttl` that was **not in this repo**. Each
answers exactly one hardcoded question, so anything
they did not precompute was unanswerable:

- transitive hardening. The node panel lists measures
  for a node's *exact* class, because that is what the
  projection stores. A `d3f:Password` never collects
  what D3FEND aims at `d3f:Credential`, which is
  where most of the useful measures live.
- negative questions — which artifacts have *no*
  measure, which tactics are unaddressed. A
  per-class lookup table cannot express an absence.
- a `d3f:` class name that does not exist. The
  completion list can offer the right names but
  cannot say that a name already typed is wrong.

The RDF document was equally unqueryable: `GraphStore`
exposed `getQuads`, `getSubjectQuads` and
`distinctPredicates` and nothing else.

## Decision

- [x] **Two tiers of RDF.** *Document graphs* are
  small and authored: they are serialized to the TriG
  pane, drawn in the graph view, and queryable.
  *Knowledge bases* are large and read-only: queryable
  and nothing else.

  This is the load-bearing decision. A knowledge base
  is deliberately **not** a `graphContribution`,
  because `renderTurtle()` serializes every
  contribution into a CodeMirror pane and
  `buildGraphModel()` turns every contribution into
  Cytoscape elements. 130k ontology triples survive
  neither. `renderTurtle`, `buildGraphModel`,
  `applyGraphVisibility` and `graphVisibility.js` are
  therefore untouched by this ADR.

- [x] Query scope is **every document graph plus every
  loaded knowledge base**, regardless of the Graphs
  chip. That chip filters the drawing, and the TriG
  pane already ignores it
  ([ADR 0014](0014-graph-view-from-rdf-only.md) calls
  that the one place data and view diverge) — queries
  follow the pane. A query narrows with `GRAPH ?g`.

- [x] Knowledge bases get their own **Sources** chip
  rather than a row in the Graphs chip. The Graphs
  checkbox means *draw this*; this one means *make
  this queryable*. Two verbs, two controls.

- [x] **oxigraph, in a Web Worker.** Full SPARQL 1.1
  including property paths, a Rust turtle parser, and
  node/browser parity so the engine is testable
  headlessly. The worker is not optional: parsing
  3.6 MB of turtle and joining over ~130k triples
  would freeze the tab, and `Store.query()` is
  synchronous — there is no yielding inside it.

- [x] The oxigraph module is **injected** into
  `createQueryEngine`, not imported by it. The browser
  and node entry points differ (`oxigraph/web.js`
  needs an explicit `init(wasmUrl)`), and injection is
  what lets a test drive the real engine with no
  Worker.

- [x] The ontology is a **lazily fetched asset**, not
  an import: `app/public/kg/d3fend.ttl.gz`, inflated
  in the worker with `DecompressionStream`. ~400 KB on
  the wire instead of 3.6 MB, and nothing is fetched
  until the user opens the pane or ticks a Source, so
  users who never query pay nothing.

- [x] Document graphs are pushed to the engine **on
  Run**, never on an edit. All of them every time,
  unioned with the previously synced names so a
  deleted graph is cleared: the document is a few
  hundred quads, and dirty-tracking would thread
  through three call sites to save under a millisecond.

- [x] Query-layer prefixes (`K:`, `Q:`, `xsd:`) live
  in `queryPrefixes.js`, **not** in `PREFIXES`.
  `toTurtle` hands `PREFIXES` to n3's Writer, which
  emits every entry whether used or not, so adding one
  there rewrites the TriG pane's header and all 14
  snapshots for prefixes no diagram uses.

- [x] A **row cap at both ends**: the engine returns
  at most 5000 rows and says when it truncated; the
  table renders 500 and says so. No implicit `LIMIT`
  injection — silently rewriting the user's query
  changes its meaning.

- [x] A query naming a knowledge base that is not
  loaded **loads it** rather than running. Querying
  `K:d3fend` unloaded returns zero rows, which reads
  as "no findings" — the most misleading thing this
  feature could do.

- [x] **OWL existential restrictions are flattened
  into direct triples when a knowledge base loads.**
  D3FEND states a relation as
  `?c rdfs:subClassOf [ owl:onProperty d3f:hardens ; owl:someValuesFrom ?t ]` and *usually* also asserts
  `d3f:hardens ?t` directly — but not always and never
  uniformly: `d3f:preceded-by` has 115 restrictions
  and no direct triples at all, `d3f:has-participant`
  144 against 3. Reading only direct triples
  under-reports silently and unevenly, which is the
  same "no findings" failure as an unloaded knowledge
  base. Materializing once at load beats a `UNION` in
  every query, canned or hand-written. The count is
  reported to the Sources chip.

## Consequences

Pros:

- The ontology and the diagram are joinable, so
  transitive and negative questions are answerable at
  all: `rdfs:subClassOf*`, `FILTER NOT EXISTS`,
  `COUNT` grouped by tactic.
- The heavy data never touches the main thread's heap,
  the TriG pane or Cytoscape — by construction, not by
  discipline.
- Vendoring `d3fend.ttl` makes
  `app/scripts/build-d3fend-*.py` reproducible for the
  first time; they took a path that was not in the
  repo.
- A further knowledge base is a file in
  `app/public/kg/`, an entry in `knowledgeBases.js`
  and some `.rq` files. No engine, worker or UI change.

Cons:

- **A running query cannot be interrupted.**
  oxigraph's `query()` is a synchronous wasm call with
  nothing to signal, so Cancel terminates the worker
  and respawns it, reloading the knowledge bases from
  the HTTP cache (~parse time, not download time).
  This is the honest limit of the engine choice; a
  streaming engine like Comunica would cancel
  properly, at the cost of running on the main thread
  or being much slower.
- A wasm dependency, and the `Store.load()` signature
  changed between oxigraph 0.3 and 0.4 — the version
  is pinned and the loader retries the old form before
  failing with a message that names the problem.
- The document exists twice while a query runs, once
  as n3 quads and once inside the engine. Irrelevant
  at a few hundred quads, and the reason the sync is
  cheap enough to do wholesale.
- The three JSON projections stay. They serve
  synchronous keystroke paths — completion, hover, the
  node panel — and an async worker round-trip per
  keypress would regress typing. So the ontology is
  now in the repo twice, as turtle and as three
  derived JSONs.
- Two prefix sets to keep straight, and the reason is
  a quirk of n3's Writer rather than anything about
  RDF.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- The engine adapter is
  [app/src/query/queryEngine.js](../../app/src/query/queryEngine.js)
  (`createQueryEngine(oxigraph)`); the worker is
  `queryWorker.js`; the main-thread façade is
  `queryClient.js`.
- `app/test/query-engine.test.js` runs real SPARQL
  under node against a ~10-triple fixture ontology, not
  the 3.6 MB file.
- Terms cross `postMessage` flattened to
  `{ termType, value, language, datatype }`;
  `query/flatQuads.js` turns them back into n3 quads
  for the CONSTRUCT→named-graph path.
- The manifest is
  [app/src/rdf/knowledgeBases.js](../../app/src/rdf/knowledgeBases.js).
  Graph names are `urn:d3fend-graph:kg:<id>`, rendered
  `K:<id>`.
- Canned queries tell document graphs from knowledge
  bases with
  `FILTER(!STRSTARTS(STR(?g), STR(K:)))`.
- `d3fend.ttl` states relations **both** ways, as a
  direct triple *and* as an `owl:Restriction` blank
  node, but the direct form is incomplete — see the
  materialization decision above. It was measured on
  the real file: 1788 restrictions, of which 1787 are
  `owl:someValuesFrom` and one `owl:allValuesFrom`,
  all attached through `rdfs:subClassOf`, with no
  cardinality, `owl:hasValue`, `owl:onClass` or
  `owl:equivalentClass` anywhere. That is why one
  INSERT rule covers it.
- `rdfs:subClassOf*` also walks into those restriction
  blank nodes. They join against nothing and drop out,
  at the cost of some wasted intermediate bindings.
- `MATERIALIZE_RESTRICTIONS` in
  [queryEngine.js](../../app/src/query/queryEngine.js)
  substitutes `%G%`, so it runs against one named graph
  and never the whole store.
- `app/public/kg/d3fend.ttl.gz` is committed, so a
  clone queries the ontology with no build step. The
  README says how to regenerate it.
- The D3FEND-specific "produce it with gzip -9 …"
  advice that used to be hardcoded in the worker's
  error path now comes from a `missingHint` on the
  manifest entry, since it is wrong advice for any
  other knowledge base — see
  [ADR 0025](0025-legal-knowledge-bases.md).
