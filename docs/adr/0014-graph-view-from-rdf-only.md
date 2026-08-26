# 14. The graph view is built from RDF only

Date: 2026-08-01

## Status

Accepted

## Context

The pipeline is meant to be two independent steps:

1. mermaid → trig
1. trig → filtered graph view

Step 2 was not independent. Alongside the quads, the
emitter returned edge metadata, a containment map and
a node-id list built straight from the mermaid AST,
and the app carried them through to the view, which
drew the graph from that metadata and consulted the
store only for labels, types and colours. The
consequences:

- a graph that did not come from mermaid could not be
  visualised — the enrichment named graph contributed
  triples to the turtle pane but no nodes or edges,
  and the same would hold for any direct RDF import
  ([ADR 0009](0009-direct-rdf-import.md));
- the two paths could disagree. An untagged node is
  documented as not being added to the RDF graph, yet
  it still appeared in the graph view because the
  node-id list came from the AST.

## Decision

- [x] The emitter returns quads and a graph name, and
  nothing else. Everything the view needs is in the
  quads; containment travels as `d3f:contains`
  triples, which were already emitted.
- [x] A view model is derived from the store alone.
  Each triple is read as exactly one of:
  literal-valued (a node attribute, `rdfs:label` being
  the displayed one), `rdf:type` (classes → colour and
  node kind), a containment predicate (`d3f:contains`
  → compound parent/child), or otherwise an edge.
- [x] Nodes are the resources that appear as a subject, or as the object of an
  edge or containment triple. Class IRIs and literals are not nodes.
- [x] The step that turns that model into a drawing
  takes the model plus the filter state. It has
  nothing from the RDF layer and no knowledge of
  mermaid.
- [x] The store holds only the visible named graphs,
  so hiding one empties it there. The Turtle pane is
  therefore serialized from the parsed contributions
  instead of from the store: it documents what the
  editor produced, while the Graphs chip filters the
  view. This is the one place where the two
  deliberately diverge.
- [x] Presentational mermaid syntax with no RDF meaning is dropped at step 1.
  In practice that is the dotted/solid arrow style, which the examples use
  inconsistently (the same predicate is dotted in one diagram and solid in
  another) and which never carried a defined meaning.

## Consequences

Pros:

- Any turtle in the store renders: the enrichment graph now shows its own nodes
  and relations, and a direct RDF import needs no extra plumbing.
- Hiding a named graph needs no bookkeeping: the store is the only input, so
  emptying a graph removes its nodes and edges by construction.
- The model is built once per store change and reused
  across filter re-renders, replacing a per-node
  full-store scan with a single pass.
- Blank nodes, IRIs outside the diagram namespace, and
  containment cycles are all handled, because
  arbitrary RDF is now an expected input.

Cons:

- A node with no triples at all — untagged *and* unconnected — no longer
  appears. This matches the documented rule for RDF emission, but it is a
  change to what the graph pane shows.
- Edge line style no longer distinguishes dotted arrows.
- Any future per-edge presentation must be expressed in
  RDF to reach the view. Anything that must not be
  expressed in RDF has to be resolved outside the
  pipeline instead
  ([ADR 0017](0017-go-to-mermaid-source.md)).

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- `emitQuads` now returns `{ quads, graphName }`. The
  three things it dropped were `edgeMeta`,
  `containment` and `nodeIds`, carried through
  `main.js` into `toCytoscapeElements`.
- The view model is
  [app/src/rdf/graphModel.js](../../app/src/rdf/graphModel.js);
  the drawing step is
  [app/src/viz/toCytoscape.js](../../app/src/viz/toCytoscape.js),
  which has no imports from the RDF layer.
- The scan it replaced was `getQuads(null)` per node,
  three times over.
- The diagram namespace is `urn:d3fend-graph:`
  ([ADR 0003](0003-diagram-to-trig.md)).
- The untagged-node rule is documented in
  `testcases.md` under `id-is-graph-name`.
- Node icons resolve from `rdf:type` because of this
  ADR, not from the mermaid `icon:` attribute
  ([ADR 0015](0015-graph-visualization-preferences.md)).
