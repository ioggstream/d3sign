# 8. Show Node Information

Date: 2026-07-09

## Status

Accepted

## Context

Given a node, I want to see all
of its RDF properties,
together with some d3fend metadata (definition, kill-chain phase, etc.)
for the associated d3fend class(es).

## Decision

Content:

- [x] The panel shows all of its RDF properties;
- [x] The panel shows its d3fend metadata;
- [x] The panel allows showing the information of the kill chain and the defensive measures associated with the node, if any.
- [x] The d3f:Artifact description should be shortened at 120 charactes, with a "show more" button to expand it to the full description.
- [x] The Attack and Defense information are shown in separate sections
- [x] The relations shown include the ones the
  ontology states as OWL restrictions
  (`rdfs:subClassOf [ owl:onProperty … ; owl:someValuesFrom … ]`), which is how D3FEND
  states most of them — a class that is not a
  digital artifact, such as `d3f:User`, has almost
  nothing to show without them. The metadata build
  flattens them exactly as the SPARQL pane does at
  load time ([ADR 0020](0020-sparql-query-engine.md)),
  so the two views cannot disagree about what the
  ontology says;
- [x] `Defense` holds only relations whose other end
  is a `d3f:DefensiveTechnique`. Everything that is
  neither an attack nor a countermeasure —
  `User d3f:has-account UserAccount`,
  `User d3f:restricted-by AccessControlList` — goes
  in a third `Relations` section: a section named
  DEFENSE that means "not an attack" tells the
  reader nothing about the row;
- [x] The `+` that adds a relation to the diagram
  ([ADR 0018](0018-add-defensive-measure.md)) is on
  every row of all three sections, and leads its row
  instead of trailing it. Rows wrap, and a trailing
  control ends up alone on the next line, detached from
  the relation it acts on;
- [x] Every active control in the panel says what it
  does on hover, and the `+` says it about its own row:
  which class it will add, how the link will read, and
  where the lines will go;
- [x] The Attack and Defense sections are shown as graphs
- [x] Show attack label, not just ID.
- [x] Show both the attack label, the id and a tooltip with the description and the attack hierarchy.

Presentation:

- [x] A double click on a node opens the modal, and so
  does `Show info` on its right-click menu. This
  started as a *single* click, which now selects the
  node instead, so that the header can name it and the
  keyboard can act on it
  ([ADR 0012](0012-fold-container-nodes.md)). A modal
  covers the graph, which is the wrong response to the
  gesture used for picking something out of the graph.
  Moving it off the single click also retired the hit
  box that restricted it to a container's label band —
  that existed only to keep a click inside a container
  from opening the container's panel instead of falling
  through to what was drawn there;
- [x] The double click is only safe because the single
  click no longer opens anything. While it did, a
  double gesture would have meant opening the panel on
  a delay and cancelling it if a second click arrived —
  a cost paid by every single click. Now the first of
  the two clicks just selects, and there is nothing to
  undo;
- [x] An edge answers the same gesture, in the same
  modal, for the same two reasons: a tap on one now
  only selects, and what a drawn link asserts is not
  legible from the drawing — the direction may be
  flipped and the arrow may stand for several folded
  links ([ADR 0019](0019-select-and-swap-edges.md)).
  One `<dialog>` serves both, so only one panel is ever
  open and the shortcut guard has a single `.open` to
  check;
- [x] The modal is hidden when ESC is pressed or when clicking on a hide/close button;
- [x] When clicking on a different node (after closing the modal), the modal updates to show the new node's information.
- [x] The node information is shown as a modal, so it's easier to show all the information, including graphical representations of the Attack and Defense information.
- [x] The panel's text size is a visualization
  preference, set from the graph's `View` chip
  ([ADR 0015](0015-graph-visualization-preferences.md))
  and separate from the node-label size: the panel is
  HTML in a modal, and a size that reads well there
  crowds the drawing.
- [ ] If a node is both a d3f:Artifact and a d3f:DefensiveTechnique, its color must be the same as the d3f:DefensiveTechnique.

An alternative considered was showing node information as a tab (e.g. alongside the Turtle/preview panes) instead of a modal. The modal was preferred: it can be triggered directly from a graph click without requiring a fixed layout slot, and it can grow to fit variable amounts of Attack/Defense content without shrinking other panes.

## Consequences

Pros:

- Exposes full RDF and D3FEND context (definition, kill-chain, attack/defense relations) without leaving the graph view.
- The modal gives Attack and Defense sections enough room to render as distinct, readable node-link groups.
- Truncating long definitions keeps the panel scannable while still allowing full detail on demand.
- RDF property lookup stays live against the store, so it never goes stale relative to the loaded diagram.
- Unlike a fixed tab, the modal doesn't take up permanent layout space when no node is selected.

Cons:

- Requires a build-time metadata extraction step that
  must be re-run whenever `d3fend.ttl` is updated,
  including reclassifying relations as attack or
  defense.
- The panel's D3FEND metadata only covers the classes
  the extraction produced; classes outside it show
  raw RDF properties only.
- The modal's native backdrop blocks interaction with the underlying graph while open: the user must close it before clicking a different node, unlike a non-blocking sidebar or tab.
- Adds a second data-loading path (metadata JSON) alongside the existing RDF store, increasing bundle size modestly.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- The extraction step is
  `app/scripts/build-d3fend-metadata.py`; the coverage
  limit is whichever classes are present in
  `d3fend-categories.json`. It takes a `.ttl` or a
  `.ttl.gz`, so it runs against the vendored
  `app/public/kg/d3fend.ttl.gz` with no external file:
  `python3 app/scripts/build-d3fend-metadata.py app/public/kg/d3fend.ttl.gz`.
- `materialize_restrictions()` in that script is the
  same rewrite as `MATERIALIZE_RESTRICTIONS` in
  `app/src/query/queryEngine.js`. Because the ontology
  states some relations *both* as a direct triple and
  as a restriction, the emitted rows are deduplicated
  on `(predicate, direction, target)`.
- The three-way `kind` (`attack` / `defense` /
  `related`) is the *partner* class, not the relation:
  `attack` when it carries a `d3f:attack-id`,
  `defense` when it is in the `d3f:DefensiveTechnique`
  subclass closure, `related` otherwise. In the
  vendored snapshot that closure has 273 classes; the
  ~226 other `d3fend-id` classes outside it are
  analytic/ML method classes, not countermeasures.
  `nodePanel.js` buckets an unknown or missing `kind`
  into `Relations`, so a metadata file built before
  this still renders every row. The sibling scripts and
  their regeneration cost are listed in
  [ADR 0002 (completion)](0002-d3f-completion.md).
- The double click is cytoscape's `dbltap`, and its
  window is *not* left at the default: cytoscape gives
  a double click 250ms, about half what a desktop
  environment does, so a deliberate one arrived as two
  single taps and the panel never opened. The graph
  pane raises `multiClickDebounceTime` to 500ms.
  Cytoscape also suppresses `tap` (and so `dbltap`)
  when it decides the pointer dragged, and nodes are
  grabbable by default — so a double click with enough
  movement in it still reaches nothing.
- The retired hit box now serves a different purpose:
  the container label band is shared geometry for the
  label, the icon, the tap target and the layout
  padding
  ([ADR 0015](0015-graph-visualization-preferences.md),
  [ADR 0016](0016-nodes-outside-their-container.md)).
- The right-click menu this ADR puts `Show info` on is
  the same one that carries fold/unfold
  ([ADR 0012](0012-fold-container-nodes.md)) and
  `Go to mermaid source`
  ([ADR 0017](0017-go-to-mermaid-source.md)).
