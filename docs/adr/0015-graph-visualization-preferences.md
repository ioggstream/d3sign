# 15. D3FEND Graph: visualization preferences and D3FEND icons

Date: 2026-08-03

## Status

Accepted

## Context

The graph pane was called *Filtered graph*, which named a mechanism (the filter
chips) rather than the thing on screen. It renders the whole RDF store, filtered
or not, so *D3FEND Graph* is what it is.

Its rendering was also entirely fixed: one hardcoded cytoscape stylesheet and one
hardcoded ELK spacing block. Two consequences showed up in use:

- a diagram with many small nodes and a diagram with a few large containers want
  different spacing, node sizes and label sizes, and dense graphs are unreadable
  with a predicate name on every link;
- nodes were plain coloured dots keyed on their D3FENDCore branch, so four
  colours had to carry the whole taxonomy. The
  [d3fend-icons](https://github.com/ioggstream/d3fend-icons) set was already
  fetched for the mermaid preview and unused by the graph.

## Decision

- [x] The pane is named D3FEND Graph — the tab, the
  pane heading, the docs.
- [x] A fourth header chip, View, holds the
  visualization preferences, using the same popover
  chip as Graphs/Nodes/Links and reachable with
  `Alt+V` while the graph tab is showing, printed on
  the chip as every chip's chord is
  ([ADR 0013](0013-graph-view-controls.md)). It has no
  count, so its count span collapses instead of paying
  for the gap.
- [x] The preferences are node style (colours /
  icons), label detail, node spacing, node size, label
  size, link labels and panel text size. The last one sizes the
  info panel ([ADR 0008](0008-show-node.md)) and is
  deliberately *not* the label-size slider: the panel
  is HTML in a modal and the labels are cytoscape
  text, so a size that reads well in one crowds the
  other. They are view state, like the filters and
  the graph-visibility set: persisted per browser,
  never emitted into the RDF store. Ranges and
  defaults are declared in one place, which the loader
  clamps against, so a hand-edited value cannot
  produce an unusable view.
- [x] Label detail has two settings. *Full* stacks the
  id, the `rdfs:label` and the `rdf:type`, which is what
  the drawing has always said. *Name only* draws the
  name a node goes by — its `rdfs:label`, or its id when
  it has none — and moves the id and the `rdf:type` to a
  hover tooltip. Hover rather than nothing: the id is
  what the info panel ([ADR 0008](0008-show-node.md)),
  go-to-source and every filter are keyed on, so it has
  to stay reachable without a double click. The fold
  marker stays on the node in both settings — it reports
  what the *drawing* is hiding rather than what the RDF
  says, and it is the only place a fold's size is shown
  ([ADR 0012](0012-fold-container-nodes.md)).
  *Full* is the default: the setting changes what a
  reader can identify at a glance, so it is opted into.
- [x] The label is emitted from RDF in parts and
  composed for drawing in one function, rather than
  built once in the view model. What is drawn has to be
  the same text three places measure — the stylesheet's
  `label`, a container's label band, and the padding ELK
  reserves for it — and a container whose band was sized
  from different text than the style draws would not
  match the room kept clear around it. Composing at draw
  time also makes the setting a restyle rather than a
  rebuild of the element set.
- [x] Layout spacing is derived, not fixed: each
  layout's options are a pure function of the
  preferences, mapping one node-spacing slider onto
  whatever knob the algorithm exposes — explicit ELK
  gaps, cose's edge-length and repulsion, or a spacing
  factor for cytoscape's own layouts. One slider
  therefore means the same thing in all ten layouts.
- [x] The stylesheet is built by a pure function of
  the preferences and the icon set, kept out of the
  module owning the cytoscape instance so it can be
  asserted on without one. Applying preferences always
  restyles; it re-runs the layout only for the
  preferences that change how much room a node needs,
  since a re-run discards any positions the user
  dragged nodes into.
- [x] Icons are resolved from `rdf:type`, not from the
  mermaid `icon:` attribute: the graph view is built
  from the RDF store alone
  ([ADR 0014](0014-graph-view-from-rdf-only.md)), and
  the attribute never reaches RDF. The view model
  carries the class's D3FEND local name; resolving it
  to an icon is the stylesheet's job, so the RDF→view
  mapping stays free of presentation.
- [x] Because the icon set is small and the ontology is
  large, resolution walks up the D3FEND class
  hierarchy and uses the nearest ancestor that has an
  icon, reusing the hierarchy the editor's completion
  data already carries
  ([ADR 0002](0002-d3f-completion.md)). A class with
  no icon above it keeps its coloured dot, so the two
  modes mix in one drawing.
- [x] An offensive technique is drawn red, in both
  modes, whatever branch it belongs to. D3FEND puts an
  ATT&CK technique on the same `Plan` branch as the
  countermeasure against it, so by branch alone the
  attack and the defence are the same green — and in a
  threat model that is the first distinction a reader
  looks for. It is a second fact about the node, not a
  fifth branch: the Nodes filter still buckets an
  attack as Tactical, because that is what it is a plan
  of, and only the colour says whose plan.
- [x] Icons are tinted with their D3FENDCore branch
  colour on a white chip outlined in the same colour,
  so switching to icons adds information without
  losing the branch the colours conveyed. One table is
  the single source for the fill and the tint.
- [x] The icon set is fetched once per session from a
  CDN, shared with the mermaid preview. An unreachable
  set resolves to nothing and every node falls back to
  colours: icons are a visual nicety, never a
  precondition for rendering.
- [x] A container node draws its icon at its top-left
  corner, immediately left of its label — pinned at a
  fixed size rather than fitted to the node's box,
  which for a container is the children's bounding
  box. The container's label band is shared geometry:
  it is the container's cytoscape padding, the
  stylesheet anchors the icon and the label inside it,
  the tap handler uses it as the container's hit box,
  and the layout is given the same padding so children
  are not laid out underneath
  ([ADR 0016](0016-nodes-outside-their-container.md)).

## Consequences

Pros:

- One slider means the same thing across every layout,
  and adding a layout still costs a single table
  entry.
- The container band is computed in one place, so node size, label size and icon
  mode can no longer desynchronise the label, the click target, the container's
  own padding and the ELK padding — a class of bug the previous hardcoded
  triplet of magic numbers invited.
- The icon set can grow upstream with no change here, and every subclass of a
  newly-iconified class picks it up through the hierarchy walk.

Cons:

- Icon mode depends on a network fetch, so the first paint of a session is always
  colours and the icons appear a moment later.
- The icon set covers roughly a quarter of D3FEND's
  classes through the ancestor walk, so icon mode is a
  mix of glyphs and coloured dots, and a broad
  ancestor such as `DigitalArtifact` stands in for
  many distinct classes. Two upstream icons name no
  D3FEND class the app knows, so nothing can resolve
  to them.
- Node spacing, node size and label size all feed the layout, so moving those
  sliders re-runs it and discards manually dragged positions. Label detail joins
  them: fewer lines per node is less room a container needs.
- In *Name only*, two nodes carrying the same
  `rdfs:label` are indistinguishable until one of them
  is hovered — the drawing no longer shows the one
  thing that is unique.
- The tooltip is a hover affordance, so on a touch
  device the id and the `rdf:type` are reachable only
  through the info panel.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- `drawnLabel(data, prefs)` in
  [graphPrefs.js](../../app/src/viz/graphPrefs.js) is
  the single source for the drawn text, called by
  `graphStyle.js`'s `label` mapper, `applyContainerBands`
  in `graphPane.js` and `elkNodeOptions` in
  `layouts.js`. `toCytoscape.js` emits the parts —
  `displayId`, `name`, `rdfType`, `foldNote` — and keeps
  `data.label` as the full stack, which is what to read
  when you want a node's identity rather than its
  drawing. `labelDetail` must stay in `LAYOUT_AFFECTING`
  (`graphPane.js`), and `LABEL_DETAILS` is coerced in
  `normalizePrefs` beside `NODE_STYLES` — not in
  `PREF_RANGES`, which `clamp` would mangle.
- The tooltip is `createNodeTooltip` in `graphPane.js`,
  a child of the cytoscape container like the context
  menu. Its CSS must not set `display`: an author
  `display` outranks the UA rule for `[hidden]`, and a
  tooltip that cannot hide changes the container's client
  size, which `cy.resize()` measures — with the pane's
  ResizeObserver watching, the graph flickers. `.pane[hidden]`
  in `app.css` documents the same trap.
- `nodePanel.js` titles the info panel from `displayId`;
  it used to take the label's first line, which is the
  id only while the whole stack is drawn.
- The chip is the shared
  [filterChip.js](../../app/src/viz/filterChip.js).
  Ranges, defaults and clamping are in
  [graphPrefs.js](../../app/src/viz/graphPrefs.js);
  the persisted key is `d3fend-graph:view-prefs` in
  `localStorage`.
- `panelFontSize` is the one preference `graphPane`
  never sees: `main.js` hands it to
  `applyPanelFontSize` in
  [nodePanel.js](../../app/src/viz/nodePanel.js),
  which writes `--node-panel-fs` on the shared
  `<dialog>`. Every font size under `.node-panel` in
  `app.css` is an `em` of that, so the slider moves the
  edge panel too. The panel's `width` is in `em` for
  the same reason — the box grows with the text instead
  of reflowing a fixed 480px column — bounded by
  `max-width: 80vw`.
- `editorFontSize` is the second preference outside
  `graphPane`, and outside the graph pane altogether:
  `main.js` hands it to `applyEditorFontSize` in
  [editorPane.js](../../app/src/editor/editorPane.js),
  which writes `--editor-fs` on the root element. One
  `.cm-editor` rule in `app.css` reads it for all three
  panes, replacing the fixed `--fs-sm` the TriG and
  SPARQL editors carried and giving `#editor-host` — which
  had been taking the 16px document default — its first
  explicit size. `main.js` calls `requestMeasure()` on
  all three panes afterwards: CodeMirror caches character
  metrics, so the new size would otherwise wrap and place
  the caret against the old one.
- The stylesheet is `buildStyle(prefs, iconSet)` in
  [graphStyle.js](../../app/src/viz/graphStyle.js),
  kept out of `graphPane.js`.
- Spacing knobs per layout live in each `LAYOUTS`
  entry's `options` function
  ([ADR 0013](0013-graph-view-controls.md)): explicit
  ELK gaps, cose's `idealEdgeLength` / `nodeRepulsion`,
  or `spacingFactor`.
- `toCytoscape.js` carries the class local name as
  `typeName`. The hierarchy walk reads `parents` from
  [d3fend-completions.json](../../app/src/data/d3fend-completions.json)
  through the editor's `getItem`.
- Branch colours are `CATEGORY_COLORS`; `nodeColor(ele)`
  is what every node style actually calls, and it
  answers `OFFENSIVE_COLOR` for `ele.data('offensive')`.
  That flag comes from `graphModel.js`'s `isOffensive`,
  which reads the `offensive` key
  `build-d3fend-metadata.py` writes for the
  `d3f:OffensiveTechnique` closure plus everything with
  a `d3f:attack-id` (866 classes in the vendored
  snapshot). The same set decides the panel's `attack`
  rows, so a red node and an ATTACK row always agree.
- The icon set is fetched by
  [icons.js](../../app/src/viz/icons.js) from the
  jsDelivr GitHub CDN, resolving to `null` when
  unreachable.
- The container band is `CONTAINER_INSET` /
  `containerLabelBand`. The alternative rejected for
  the container icon was `background-fit: contain`.
- The two unresolvable upstream icons are
  `MultiFactorAuthentication` and `TestRunner`.
- The magic numbers the band replaced were a
  `24`/`40`/`48` triplet.
