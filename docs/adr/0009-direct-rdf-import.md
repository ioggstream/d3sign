# 9. Direct RDF editing, decoupled from mermaid

Date: 2026-07-27

## Status

Accepted

## Context

Mermaid text used to be the only source of truth: the
editor's text drives the parse, which emits quads into
the diagram's named graph and feeds both the mermaid
preview and the graph view. RDF could be read in a
read-only pane but never authored, so a graph that did
not come from mermaid — an enrichment file, an import
— could not be touched at all.

The RDF pane also sat under the mermaid editor in a single column, halving the
height available to both.

## Decision

- [x] Mermaid stays a one-way source: there is no RDF→mermaid generator, and the
  mermaid parser remains the only translation direction.
- [x] The RDF pane becomes editable and moves into a
  column of its own, with the mermaid editor to its
  left and the preview/graph tabs to its right.
  `Alt+,` folds the column away, moving the pane into
  the views column as a third tab
  ([ADR 0013](0013-graph-view-controls.md)) rather
  than hiding it.
- [x] The pane holds the whole document as TriG, not
  one graph's Turtle: the serializer already writes
  named graphs as blocks, so a parser reads them
  straight back with graph membership intact. Triples
  typed outside any block land in a `manual` graph.
- [x] Edits are applied on a debounce, or at once on
  `Ctrl+Enter` and on blur — half-typed RDF is invalid
  far more often than half-typed mermaid, so
  re-parsing per keystroke would be a stream of
  errors. The debounce is several seconds, not the
  editor's. Text that fails to parse changes nothing
  and reports on the lint line.
- [x] A successful parse rebuilds the parsed
  contributions wholesale: the pane is the whole
  document, so a deleted block is a deleted graph.
  Contributions, not just the store, because a later
  visibility toggle re-applies them.
- [x] Editing the pane marks it dirty. Mermaid edits
  keep driving the graph but stop rewriting the pane,
  and a badge plus a `Regenerate` button, which
  re-runs the mermaid source, is the only way back.
  This replaces the silent overwrite originally
  proposed here.
- [x] Visibility selection stays sticky across all of
  this: it is saved only from explicit user toggles,
  never from a pane-driven rebuild, because saving
  prunes hidden names absent from the document and a
  graph being retyped would come back visible.

## Consequences

Pros:

- RDF that never came from mermaid can be inspected and edited, in one pane
  rather than two competing editors.
- No RDF→mermaid generator to build or maintain.
- Both editors get a full-height column.

Cons:

- Mermaid and TriG are both authoritative, so they can
  disagree; the dirty badge and `Regenerate` are the
  whole reconciliation story.
- Deleting the enrichment block removes it for the
  session: it is loaded once, so it only returns on
  reload. Unchecking it in the Graphs chip is the
  reversible way to get rid of it.
- Three columns want roughly 1200 px of width; below that `Alt+,` is not
  optional.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- The pane is `createTurtlePane` in
  [app/src/editor/editorPane.js](../../app/src/editor/editorPane.js),
  a CodeMirror instance like the mermaid editor.
- Round trip: `toTurtle` writes named graphs as
  `G:name { … }` blocks,
  [parseTrig.js](../../app/src/rdf/parseTrig.js) reads
  them back. Orphan triples go to
  `urn:d3fend-graph:manual`.
- The debounce is 3 s. The mermaid editor's is 200 ms
  ([ADR 0017](0017-go-to-mermaid-source.md)).
- The wholesale rebuild target is
  `graphContributions`; the sticky-visibility function
  that must not be called from it is
  `saveVisibleGraphs`.
- Enrichment is loaded by `ensureEnrichment()`, which
  runs once per session
  ([ADR 0003](0003-diagram-to-trig.md)).
- The entry point that ties parse, emit, preview and
  view together is `handleTextChange` in `main.js`.
