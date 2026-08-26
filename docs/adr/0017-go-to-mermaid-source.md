# 17. Go to mermaid source from the graph

Date: 2026-08-06

## Status

Accepted

## Context

The editor drives the graph and nothing comes back.
A node in the D3FEND Graph view says what it is
([ADR 0008](0008-show-node.md)) but not where it was
written, so on a document with several mermaid blocks
the way back to the source is a manual search.

That search is worst exactly where it is needed most.
A node has a name, so it can at least be typed into
the editor's find panel and stepped through. An edge
has none: finding one by hand means searching for an
endpoint and checking every occurrence. Edges are
also where the D3FEND semantics live — the predicate
CURIE is the token most often wrong — and one drawn
edge can stand for several written ones once a fold
has collapsed a group of links
([ADR 0012](0012-fold-container-nodes.md)).

The obvious implementation is forbidden.
[ADR 0014](0014-graph-view-from-rdf-only.md) makes
the RDF store the view's whole input, and the view
knows nothing about mermaid. Carrying a source
position from the parser through to the drawn element
is the side channel that ADR deleted.

## Decision

- [x] Right-click a node or an edge in the graph view
  for a "Go to mermaid source" item, which scrolls
  the mermaid editor to where that element is
  written, selects it and flashes it.
- [x] `g` does the same for the selected element, under
  the same guards as the other unmodified shortcuts
  ([ADR 0013](0013-graph-view-controls.md)). It answers
  on an edge as well as on a node: edges became
  selectable when the swap moved off their left click
  ([ADR 0019](0019-select-and-swap-edges.md)), which is
  the only thing that had kept this action menu-only,
  and the edge menu now advertises the key like every
  other item.
- [x] The menu item names the key beside it. The menu
  is the only place the gestures are written down, so
  it is where they are taught — the same question
  ("what can this element do?") is already answered in
  one place for the cursor hint and the menu, and the
  key belongs with the answer.
- [x] The mapping from a drawn element back to its
  source is resolved at click time, by re-scanning
  the editor's current text. No line number, offset
  or source reference is added to the AST, to the
  quads, to the view model or to the drawn elements.
- [x] Source provenance is not emitted as RDF either.
  It would satisfy the letter of ADR 0014, but it
  puts authoring-tool bookkeeping into the user's
  exported graph, goes stale the moment a line is
  inserted above it, and churns the TriG pane on
  every edit.
- [x] An element with no mermaid origin — an
  enrichment resource, anything typed into the TriG
  pane — has no menu item. Absence, not an error: it
  is the normal state for a large part of the graph.
- [x] Repeated activation cycles. The first jump
  lands on a declaration, before any bare mention;
  activating again advances to the next occurrence
  and wraps. The caret is the whole of the state.
- [x] What the graph drew is matched back to what was
  written: an inverted relation
  ([ADR 0007](0007-classify-graph-links.md)) and an
  endpoint re-anchored by a fold are undone before
  the lookup.
- [x] What counts as an id is decided by the parser,
  not by a second pattern of its own: an id the
  parser did not name on that line never becomes a
  location, so a stray token cannot produce a wrong
  jump.

Resolving at click time is the decision the rest
follows from. Because the answer is computed from the
live document rather than from the last successful
parse, a position cannot be stale: not behind the
editor's debounce, not wrong while a fence is
unterminated, not invalidated by an edit above it.
It also costs nothing when unused.

Right-click rather than left-click, for the reason
[ADR 0012](0012-fold-container-nodes.md) anticipated
when it put fold/unfold there: left-click already
means "inspect" and opens a modal dialog
([ADR 0008](0008-show-node.md)), whose backdrop would
be covering the editor at the moment of the jump.
On an edge, left-click selects, exactly as it does on
a node, and `g` reaches this jump from the keyboard
([ADR 0019](0019-select-and-swap-edges.md)).
The context menu has no such conflict, and it works
on a container's whole body rather than only the
label band a left-click is restricted to.

Cycling is what covers the cases with no single right
answer: an id deliberately re-declared in a second
named graph ([ADR 0003](0003-diagram-to-trig.md)
makes id identity document-wide), and a folded edge,
which walks the links it collapsed.

## Consequences

Pros:

- The graph becomes a way to navigate the document,
  not only to read it. This is the first thing to
  travel from the view back to the editor.
- ADR 0014 holds unchanged: the view still receives
  nothing but the store, and the graph pane never
  learns what a mermaid id or a triple is.
- The record of what a fold collapsed, kept by
  ADR 0012 so that collapsing links was not lossy,
  finally has a consumer.
- The scan is a pure function of the document text,
  so it is unit-tested without a browser, and it is
  half of what the reverse direction (caret →
  highlight the node in the graph) would need.

Cons:

- Deciding what is an id and locating it on the line
  are two mechanisms that have to agree. They are
  wired together deliberately: what an arrow looks
  like is stated once in
  [linkGrammar.js](../../app/src/parser/linkGrammar.js)
  and read by the parser, by the mask and by the
  back-arrow diagnostic, so a new link syntax is one
  edit rather than three.
- Making them agree changed the known-id colouring
  too: ids that were silently not coloured now are.
- Cross-block containment is still block-local in the
  parser, so an id written in two blocks resolves to
  both without saying which one the clicked node came
  from. Cycling makes that navigable rather than
  wrong.

## DONTREADME

Notes for LLM agents. They are kept out of the
sections above because [ADR 0001](0001-use-adr.md)
puts implementation detail outside an ADR. They
describe the code as it is, not the decision, and go
stale: check the code before trusting them.

- The scan is `editor/sourceLocations.js`. It
  classifies each line with the parser's own
  `tokenizeLine` and statement parsers, so chains,
  `&`-groups, two-headed arrows — both directions land
  on the one predicate token written — and `id@{...}`
  endpoints resolve exactly as the diagram does. The
  offset-preserving masks in
  `editor/mermaidMasking.js` only supply columns.
- The index is built on demand and cached against the
  text it was built from, rather than recomputed per
  keystroke like `documentSymbols`.
- A declaration is a shape or a `subgraph` opening.
  Cycling reads the caret to find the occurrence
  after it, so nothing has to remember where the last
  jump landed; it matches the editor's find-next
  idiom.
- The flash lasts two seconds. The editor debounce it
  sidesteps is 200 ms.
- `goToSource.js` reverses two view transforms before
  the lookup: the Links filter may be drawing the
  relation backwards, and a fold may have re-anchored
  an endpoint onto a visible ancestor, recorded in
  `foldedFrom` / `foldedTo`. `data.predicate` needs
  no undoing — it is always the CURIE as written,
  never the inverse label, which is only ever used
  for display.
- The graph pane is handed two opaque callbacks and
  learns nothing about mermaid ids or triples.
- The mask fixes that changed colouring:
  `port-->|p| p2` and `A[Host]:::net` were previously
  mis-tokenized.
