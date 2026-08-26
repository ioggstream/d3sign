# 12. Fold container nodes

Date: 2026-07-09

## Status

Accepted

## Context

TRIG graphs have resources that are container nodes.
A container node can be any
node (e.g., a d3f:Actor, a d3f:Artifact, ...)
with a d3f:contains or another transitive property
referencing other nodes.

The Filtered Graph View can contain many nodes
but the user might want to focus on a specific level of the graph
without being distracted by the details of contained nodes.

It is the case for a d3f:DatabaseService that is composed of
many components, i.e., a d3f:Database, a d3f:LogFile, a d3f:ConfigurationFile, etc.
While this can be addressed using different graphs (i.e., using the mermaid frontmatter `id:` to separate the different levels of the graph),
it may be useful to fold selected container nodes.

## Decision

- [x] When unfolded, the container node is shown as it is, with all its contained nodes and edges visible, but with a fold/unfold button in the graph view.
- [x] When folded, the container node is shown as a single node with a special icon (e.g., a folder icon) and the contained nodes are hidden.
- [x] The Trig graph is not modified by unfolding/folding a container node, i.e., the contained nodes are still present in the graph, but they are not shown in the graph view.
- [x] Links to/from contained nodes are shown from/to the container node:
  - Given :a d3f:contains :b, and :b d3f:reads :c, when :a is folded, the graph view shows like it :a d3f:reads :c .
  - Given :a d3f:contains :b, and :c d3f:writes :b, when :a is folded, the graph view shows like it :c d3f:writes :a .
- [x] Fold/unfold is an item on the node's right-click
  menu, the first context menu in the graph view. It
  was first built as a chevron drawn in the node's
  top-right corner, which was worse on both counts
  that matter here: a glyph on a compound node has a
  geometry that the stylesheet, the tap handler and
  the layout all have to agree on, and the hit box it
  needs has to dodge the label band that already opens
  the node information panel
  ([ADR 0008](0008-show-node.md)). A menu has no
  geometry to get wrong — the pointer's position is
  the menu's position — it names the action instead of
  relying on a symbol being understood, and it leaves
  somewhere obvious for a second per-node action to go
  ([ADR 0017](0017-go-to-mermaid-source.md)).
- [x] Because nothing is drawn on the node any more,
  the pointer advertises the menu: over a node that
  offers anything, the graph's cursor becomes a
  context-menu cursor.
- [x] A selected node can also be folded with `f`. A
  left click selects, which the graph already tracked
  but never showed, and the graph pane's header
  carries a box naming the selected node and the
  action available on it. The menu item names the key
  too, so the gesture is discoverable from either the
  node or the header
  ([ADR 0017](0017-go-to-mermaid-source.md)).
- [x] The selection survives the re-render that
  folding causes. Without that, folding the selected
  node would deselect it and `f` could fold but never
  unfold.
- [x] Rather than the folder icon of the second
  decision, a folded node keeps the D3FEND icon and
  category colour resolved from its `rdf:type`
  ([ADR 0015](0015-graph-visualization-preferences.md))
  — the taxonomy is still true of it, and losing the
  class to say "folded" costs more than it tells. It
  is marked instead as a stack: an offset translucent
  copy drawn behind it, clipped corners that neither
  node style gives a leaf, and a size slightly above a
  leaf's. A double border was tried first and dropped
  — too easy to read as a selection or a hover.
- [x] The node's label carries the number of nodes the
  fold is standing in for, counted through nested
  folds, so the user can tell whether unfolding is
  worth it without unfolding.
- [x] A link whose two ends are both inside the same
  folded container is not drawn. It is the internal
  detail folding exists to hide, and as a self-loop on
  the container it would say nothing.
- [x] Several child links that collapse onto the same
  pair of nodes become one link carrying the count,
  not several curves over each other.
- [x] A link inherited from a child is drawn dashed,
  and thicker the more child links it stands for,
  since it is not a triple in the store. Its colour,
  arrow and predicate are untouched: the link's kind
  and direction are still literally true, so they must
  read exactly as an asserted link's do.
- [x] Folding both a container and a container inside
  it draws the outermost one.
- [x] A folded container that the node filter removed
  cannot fold anything, so its children resurface —
  the same rule that reparents a child onto its
  nearest visible ancestor.
- [x] Fold state is view state: persisted beside the
  filters and the visualization preferences, and never
  reaching the RDF store.

## Consequences

Pros:

- It is possible to visualize an HLA from a detailed view;
- A container's fold state costs nothing to try: it is a view toggle, so no
  amount of folding can damage the document.

Cons:

- Visual representation may not reflect the actual structure of the underlying graph, as folded container nodes hide their contained nodes.
  Partly mitigated: an inherited link is dashed and counted, so it is
  distinguishable from an asserted one, and a folded node says how many nodes it
  hides. Which child a link came from is not shown — unfolding is the answer.
- Folding re-runs the layout, so it discards node positions the user dragged, as
  every filter change already does.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- The chevron's problem, concretely: positioning a
  glyph on a cytoscape compound node means pinning a
  background layer.
- Selection was already tracked by cytoscape; its
  default `:selected` styling sets only a background
  colour, which this project's own node rule
  overrides, so it had no visible consequence.
- The header box reads like `svc · f: fold`. The
  guards that keep `f` from firing while the user
  types are in
  [ADR 0013](0013-graph-view-controls.md).
- The stack marking is an offset translucent copy plus
  clipped corners: an ellipse in colour mode, a round
  rectangle in icon mode.
- A link re-anchored by a fold records where it came
  from in `foldedFrom` / `foldedTo`, which is what
  lets a click on it walk back to the mermaid source
  ([ADR 0017](0017-go-to-mermaid-source.md)) and what
  its info panel lists as the links the one arrow
  stands for
  ([ADR 0019](0019-select-and-swap-edges.md)).
- Fold state is persisted in `localStorage`, beside
  the filter state and
  `d3fend-graph:view-prefs`
  ([ADR 0015](0015-graph-visualization-preferences.md)).
