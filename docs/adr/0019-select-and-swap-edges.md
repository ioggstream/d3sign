# 19. Select an edge; swap its direction with a key

Date: 2026-08-07

## Status

Accepted

## Context

A left click on an edge inverted its predicate's
direction. It was the only thing an edge click did,
and the whole gesture: no selection, no confirmation,
nothing named on screen before or after. Clicking one
arrow rewrote every arrow sharing its predicate,
because the direction is per-predicate state
([ADR 0007](0007-classify-graph-links.md)) — the same
state the `Links` chip's toggle writes. A user aiming
at a link to find out what it says redrew half the
diagram instead.

Nodes had the same problem once and solved it. A click
on a node used to open a modal; it now selects, the
header names what is selected, and the keys act on it
([ADR 0008](0008-show-node.md),
[ADR 0012](0012-fold-container-nodes.md),
[ADR 0013](0013-graph-view-controls.md)). Edges were
left out of that arrangement, and the exclusion was
written into the code: the pane observed only node
selection, the stylesheet drew only node selection,
and the edge menu deliberately advertised no key
because "only nodes are selectable".

Meanwhile a drawn edge is the element whose meaning is
*least* legible from the drawing. It may be reversed
and renamed relative to what was written; it may have
been re-anchored onto a folded container; and it may
be one arrow standing for several written links, whose
real endpoints `toCytoscape` records in `foldedFrom` /
`foldedTo` and nothing ever read back.

## Decision

- [x] A left click on an edge selects it, and does
  nothing else. Cytoscape already selected it — its
  default is single selection, so a click on an edge
  also clears a selected node — and the pane simply
  never looked. The graph header's box names the
  selection either way, so this is one box, not two.

- [x] The swap moves to `s` on the selected edge, and
  to `Swap direction` on its right-click menu, which
  is where the key is advertised. It stays
  per-predicate and global: the same
  `filterState.direction` entry the `Links` chip
  writes, so the two cannot disagree about which way a
  relation is being read. The header box says so —
  `s: swap all d3f:reads`, naming the predicate rather
  than the edge — because that is the part a user
  cannot infer from having clicked one arrow.

- [x] Only an invertible predicate advertises `s`, the
  way only a container advertises `f`. On the rest,
  pressing it flashes "has no inverse property" over
  the drawing, which is where the old click already
  said it: nothing is redrawn, so nothing else would
  say why.

- [x] A double click on an edge opens the info panel,
  the same gesture and the same modal as a node's
  ([ADR 0008](0008-show-node.md)). It states what the
  drawing cannot: the D3FEND definition of the
  predicate, the link kind, and — when the direction
  is flipped — which way the triple was actually
  written. On an edge derived from a fold it lists the
  links the one arrow stands for, which is what finally
  reads `foldedFrom` / `foldedTo`
  ([ADR 0012](0012-fold-container-nodes.md)).

- [x] `g` reaches "go to mermaid source" for the
  selected edge, the same action the menu already
  offered ([ADR 0017](0017-go-to-mermaid-source.md)).
  Only the "edges cannot be selected" premise had kept
  it off the keyboard.

- [x] Selection is drawn on an edge with a translucent
  halo behind the line, not by recolouring it. Three
  properties of an edge are already spoken for and all
  three have to survive being selected: the colour is
  the link kind, the dashes say the link is derived
  from a fold, and the width says how many child links
  it stands for. This is the same reasoning that made a
  selected *node* say it with the border and keep its
  fill.

- [x] The selection survives the re-render a swap
  causes, which needs more than the node rule does. An
  edge's identity in the view is derived from what is
  drawn — its endpoints and its label — and a swap
  rewrites both, so matching by id would drop the
  selection on the very keystroke that acted on it and
  leave a second `s` with nothing to swap back. The
  written predicate and the unordered pair of
  endpoints are what survive, so those are what is
  matched.

## Consequences

Pros:

- The cheapest gesture in the view no longer mutates
  it. Clicking a link to look at it is now safe, and
  the destructive reading of that click is gone.
- Every edge action is reachable, discoverable and
  reversible the same way a node's is: menu item, key,
  hint, header box. Edges stop being second-class.
- The swap's real scope is stated before it happens.
  It was always per-predicate; only now does anything
  say so.
- `foldedFrom` / `foldedTo` have a reader, so a fold
  is no longer lossy in practice as well as in
  principle.
- `s` is the third unmodified letter, and the
  shortcut table now dispatches on what kind of thing
  is selected — which is the shape any further
  per-element key needs.

Cons:

- Swapping costs a keystroke more than it used to, and
  users who had learnt the click have to unlearn it.
  The menu item is the only thing that tells them.
- Still per-predicate. A user who wants one arrow
  reversed cannot have it, and the box saying "all
  d3f:reads" explains the surprise rather than
  removing it.
- One more meaning for the same `<dialog>`: the node
  and edge panels cannot be open at once, which is
  fine, but they now have to agree on their furniture.
- The keyboard swallows `s` on the graph tab even when
  nothing is selected, consistent with `f` and `g` but
  a wider bite out of the alphabet.
- Nothing enforces that the shortcut table and the
  menu hints agree; they are still two lists.

## DONTREADME

Notes for LLM agents. They are kept out of the
sections above because [ADR 0001](0001-use-adr.md)
puts implementation detail outside an ADR. They
describe the code as it is, not the decision, and go
stale: check the code before trusting them.

- The pane reports `{ kind: 'node' | 'edge', … }` from
  `selectionOf` in
  [app/src/viz/graphPane.js](../../app/src/viz/graphPane.js).
  The edge case carries its whole `data` as well as the
  named fields, because `writtenTriplesOf` and the
  panel both need `derived` / `foldedFrom` /
  `foldedTo` — the same object the right-click menu
  gets, so the keyboard and the menu cannot answer
  differently.
- `reselectEdge` in the same file is the
  unordered-endpoint match. An edge id is
  `` `${source}->${target}:${predicateLabel}` ``
  (`viz/toCytoscape.js`), which is why the id is no
  use across a swap.
- `data.predicate` is always the CURIE as written and
  `data.label` is what is drawn, so "is this edge
  flipped?" is answerable from the element alone — no
  filter state — by the two disagreeing. That is what
  keeps `edgePanelSummary` a pure function of one
  argument.
- The predicate's definition comes from
  `d3fend-completions.json` through
  `editor/d3fendHierarchy.js`, not from
  `d3fend-metadata.json`, which holds classes only.
  It is looked up for the *written* predicate: the
  inverse names come from `rdf/inverse-map.json` and
  are display labels D3FEND need not define
  (`d3f:read-by` is not a property).
- `inverse-map.json` names each pair once and
  `inversePredicateOf` (`rdf/emit.js`) derives the
  reverse, so writing either leg gives a swappable
  edge: with only the active direction in the file, an
  edge written `|d3f:used-by|` came out
  `invertible: false` and lost both the menu item and
  `s`. Its first block is D3FEND's own `owl:inverseOf`
  pairs and its one `owl:SymmetricProperty`
  (`d3f:communicates-with`); the second is the
  invented names for drawable predicates the ontology
  declares no inverse for.
- `viz/edgePanel.js` shares the `<dialog>`, the close
  button and the CSS with `viz/nodePanel.js`, which
  exports `renderPanelFrame` and `renderDefinition`
  for it. `edgePanelSummary` holds the wording and is
  tested without a DOM; the renderer only builds
  nodes.
- The "no inverse property" toast is
  `graphPane.flashError`, exposed because `main.js`
  owns the key but not the container.
- `graphPane` no longer takes `onEdgeClick`. The swap
  is `onSwapDirection`, called from the menu and from
  `GRAPH_SHORTCUTS.s`, both landing in
  `swapPredicateDirection` in `main.js`.
- `edge:selected` must stay the last edge rule in
  `buildStyle`: cytoscape takes each property from the
  last rule that sets it. `graph-style.test.js`
  asserts the ordering.
