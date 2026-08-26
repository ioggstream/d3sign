# 3. Diagram-to-RDF Parser and Named Graphs

Date: 2026-07-25

## Status

Accepted

## Context

The app must turn markdown documents containing mermaid flowcharts annotated
with `d3f:` tokens into RDF quads, re-parsing on every edit, while keeping
optional external "enrichment" RDF (e.g. well-known auth flows) alive across
re-parses.

Mermaid's own parser is an internal jison grammar producing a render tree, not
a stable API for extracting node/edge/shape-data structures.

## Decision

- [x] Parse the annotated subset of mermaid with a
  hand-written parser of our own, independent of
  mermaid's grammar. Its output is an AST, not RDF.
  Which syntax that subset covers is not decided
  here: it is specified case by case in
  [testcases.md](../../app/src/data/examples/testcases.md),
  the fixture the parser and emitter tests run on.
- [x] Mermaid styling carries no d3fend meaning and is
  dropped while parsing, not represented in the AST.
- [x] A node's parent is the subgraph that first
  mentions it, an edge line counting as a mention: an
  endpoint declared at top level and then only wired
  up inside a subgraph belongs to that subgraph, as
  mermaid draws it.
- [x] Each diagram's quads live in a named graph of
  their own, named after the frontmatter `id:` or a
  default. A re-parse replaces just that graph's
  quads, and graphs no longer present in the document
  are dropped. Several blocks sharing one `id:` are
  merged into one graph.
- [x] Enrichment lives in its own named graph, loaded
  once and untouched by diagram re-parses. Every
  graph, diagram or enrichment, is toggled
  independently in the graphs filter chip.
- [x] Per named graph, the emitter writes: `rdf:type`
  per `d3f:` token on a node or subgraph, `rdfs:label`
  for the leftover label text, `d3f:contains` from a
  classed subgraph to each of its classed children,
  and one triple per edge, the label expanded to a
  `d3f:` CURIE if unprefixed.
- [x] An id with no `d3f:` class is not a resource, so
  it gets no triples — and an untagged subgraph is
  therefore presentational padding rather than a
  container. `d3f:contains` skips it and links the
  enclosing tagged subgraph directly to its nearest
  tagged descendants. Mermaid still draws the padding
  box; the graph view deliberately shows fewer boxes
  than the preview, being built from the RDF alone
  ([ADR 0014](0014-graph-view-from-rdf-only.md),
  [ADR 0012](0012-fold-container-nodes.md)).
- [x] Tagged-ness is a property of the id across the
  whole document. A node id denotes one RDF resource
  whatever block or named graph mentions it, so a
  class attached to it anywhere types it everywhere.
  This is what lets a subgraph re-opened without a
  title keep containing its children, and what makes
  the same id usable as a bare forward reference
  before its tagged declaration.
- [x] Emission stays a function of the document.
  Types asserted only in the store — enrichment, an
  RDF import — do not make an id tagged.
- [x] Nesting, by contrast, is scoped to the block
  that wrote it: `d3f:contains` is a quad, asserted in
  the named graph whose diagram declared the nesting,
  and the parent walk sees only that block's
  subgraphs.
- [x] An arrow head is styling like any other: `-->`,
  `--o` and `--x` yield the same triple. A head at
  each end (`<-->`, `o--o`, `x--x`) means the relation
  holds both ways, so it yields one triple per
  direction. A head on the left only is not a mermaid
  arrow at all — `<--`, `o--`, `x--` open a link that
  a right-hand head has to close — so the line renders
  nowhere and carries no triple.
- [x] The parser and the document splitter surface
  warnings rather than failing: unrecognized
  statement, back arrow, no `d3f:` node annotations
  found — the marker of an unsupported diagram
  convention — missing diagram title, duplicate
  diagram title, and a diagram `id` that is not a
  valid identifier.
- [x] A warning that can be tied to a span of text is
  also drawn on that text: the editor marks back
  arrows red. Diagnostics are computed from the live
  document like every other editor affordance
  ([ADR 0017](0017-go-to-mermaid-source.md)), never
  carried over from the parse, so no position reaches
  the AST or the store.

## Consequences

Pros:

- Parser behavior is independent of mermaid version upgrades.
- Live re-parsing is cheap: replace one named graph rather than rebuild the
  store.
- Enrichment and diagram-derived data show/hide independently.

Cons:

- Only the annotated convention is understood; other styles are flagged, not
  translated. An arrow with no `|predicate|` carries
  nothing to emit, so it is not an edge to the parser
  (`unlabelled-arrows-dropped` in testcases.md).
- An untagged subgraph split across two blocks loses
  the containment relation, since nesting is
  block-scoped while tagged-ness is not.
- Two parses run per edit — ours for RDF, mermaid's for the preview — accepted
  to keep the two concerns decoupled.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- The syntax each module accepts is enumerated in
  [testcases.md](../../app/src/data/examples/testcases.md),
  not here. Read the regexes and that fixture
  together; this list only says which module owns
  what.
- `app/src/parser/` holds one module per concern:
  - [tokenizer.js](../../app/src/parser/tokenizer.js) —
    strips `%%` comments, the `graph`/`flowchart`
    header and mermaid styling, and classifies each
    logical line as `subgraph-open`, `subgraph-end`,
    `edge` or `node`.
  - [nodeParser.js](../../app/src/parser/nodeParser.js) —
    node declarations. `d3f:Class` tokens come out of
    the label text; the remainder is the `rdfs:label`.
  - [linkGrammar.js](../../app/src/parser/linkGrammar.js) —
    what an arrow looks like, and what its heads mean.
    Imports nothing: the edge parser, the editor's
    arrow mask and the back-arrow diagnostic all read
    it rather than keeping a regex each.
  - [edgeParser.js](../../app/src/parser/edgeParser.js) —
    labelled arrows, endpoints declared inline as
    `id@{...}`, and `backArrowSpans`, which is where
    both the warning and the editor's red line come
    from.
  - [subgraphParser.js](../../app/src/parser/subgraphParser.js) —
    open/end with nesting tracked by a stack.
  - [frontmatter.js](../../app/src/parser/frontmatter.js) —
    the per-block `title`, `id`.
  - [document.js](../../app/src/parser/document.js) —
    splits a markdown document into every
    ```` ```mermaid ```` block.
- The AST is
  `{ frontmatter, nodes, edges, subgraphs, warnings }`.
- Names: graphs are `urn:d3fend-graph:<diagramId>`
  with `current` as the default id, nodes are
  `urn:d3fend-graph:<nodeId>`, rendered as the `G:` /
  `E:` CURIE prefixes in
  [emit.js](../../app/src/rdf/emit.js). Enrichment is
  `urn:d3fend-graph:enrichment:well-known-auth`, in
  [enrichment.js](../../app/src/rdf/enrichment.js).
  A re-parse calls `store.replaceGraph(name, [])`.
- `main.js` collects the tagged ids once per parse and
  passes them to `emitQuads` as `taggedIds`;
  `emitQuads` runs before the store is updated, which
  is what keeps it a function of the document.
- `@{icon: ...}` and `@{shape: ...}` are parsed into
  the AST but never emitted; they only affect
  mermaid's own preview.
- `o` and `x` are legal id characters, so a bare o/x
  arrow head is only read as one where an id cannot
  end: glued to the dashes with whitespace or `&`
  before it. That lookbehind is what keeps `repo-->`
  the id `repo`, and it is in `linkGrammar.js` once.
- The editor's red line is
  [linkErrors.js](../../app/src/editor/linkErrors.js);
  it and `knownNodes.js` walk the mermaid body through
  `forEachMermaidBodyLine` in
  [mermaidBlocks.js](../../app/src/editor/mermaidBlocks.js).
- `emitQuads` once returned `edgeMeta`, `containment`
  and `nodeIds` alongside the quads. It no longer
  does — see
  [ADR 0014](0014-graph-view-from-rdf-only.md).
- Adding a `## section` to
  [testcases.md](../../app/src/data/examples/testcases.md)
  adds a test: `rdf-emit.test.js` runs its first
  mermaid block and snapshots the turtle under
  `app/test/snapshots/<section>.trig`. A new section
  needs `npm test` run once to write its snapshot.
- Examples that exercise the corners beyond
  testcases.md:
  [db-replica.md](../../app/src/data/examples/db-replica.md)
  re-opens `subgraph dc-1` in a later block;
  [mta.md](../../app/src/data/examples/mta.md) is the
  unsupported-convention case. The block-scoped
  nesting gap is tracked in `ISSUES.md`.
