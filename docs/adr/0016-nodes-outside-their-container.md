# 16. D3FEND Graph: a node is never drawn inside a container that does not contain it

Date: 2026-08-05

## Status

Accepted

## Context

`d3f:contains` becomes a cytoscape compound node ([ADR 0012](0012-fold-container-nodes.md)),
so a container's box is a claim about the model: what is drawn inside it is what it
contains. Nodes were being drawn inside containers that did not contain them, and
container labels over unrelated neighbours, which makes the drawing say something
the RDF does not.

No layout can be asked to prevent this. A compound node
has no position of its own — it is filtered out of the
positions a layout returns and its box is derived from
its children — so keeping a container clear of its
neighbours is something each layout has to model
internally, and of the ten offered:

- `grid`, `circle`, `concentric` and `breadthfirst` ignore parents entirely and
  place children on one global grid;
- `cose` models it as a repulsive force, which a dense graph overpowers;
- the five ELK layouts do reserve the space — but only
  for the geometry they were given, and three defects
  made what was drawn disagree with it: the
  container's padding was declared in a form cytoscape
  rejects, so containers hugged their children and
  gave away the band ELK had reserved; the container's
  own label was anchored outside the node, over
  whatever was there, nothing anywhere accounting for a
  parent's own label; and the ELK adapter sizes a
  leaf's slot with its label-inclusive box but then
  centres the node in it, so a label drawn below the
  node hangs out of the reserved space.

## Decision

- [x] The invariant is stated positively and enforced
  after the fact: for a container S and a node A that
  is not a descendant of S, the drawn box of A does not
  intersect the drawn box of S.
- [x] The three geometry defects are fixed so the ELK
  layouts satisfy it by construction: the container's
  padding is the computed label band
  ([ADR 0015](0015-graph-visualization-preferences.md)),
  the label is anchored inside the gutter that padding
  reserves, and the adapter's centring is corrected
  through the layout's own transform hook.
- [x] The container gutter is uniform. Cytoscape has no
  per-side compound padding, so the layout is given the
  same number on all four sides: any side where it
  reserves less than cytoscape draws is a side a
  neighbour is laid out inside. That padding is also
  set per container, because ELK inherits the
  hierarchy-handling option and not padding.
- [x] Whatever the layout leaves behind is corrected by
  a separation pass: each set of siblings, deepest
  level first, has its overlapping boxes pushed apart
  along the axis of least penetration, half the
  distance each. Separating siblings level by level is
  enough for the whole drawing, because a container's
  box is the union of its children's boxes plus its
  padding — so if no two siblings overlap at any level,
  two nodes in different containers cannot overlap
  either.
- [x] The pass runs after a layout and after a
  rotation, never on a manual drag: a user who drags a
  node onto a container is not corrected.
- [x] The pass is pure geometry over boxes and knows
  nothing about cytoscape, so the invariant is tested
  in this repo — no test here can instantiate a
  renderer.

## Consequences

Pros:

- The invariant holds in all ten layouts, including the four that ignore compound
  nodes, so the dropdown does not have to be pruned to the compound-aware ones.
- A container's label band is now the same rectangle in all four places that care
  about it — the label, the icon, the tap hit box and the reserved padding — so
  taps on a container's visible label open the node panel, which they never did.
- Correcting the adapter's node anchoring makes every gap a layout reserves come
  out on screen, so the node-spacing slider means what it says.

Cons:

- A container's gutter is the label band on all four sides, not just the top, so
  containers are chunkier than the children they hold — more so in icon mode,
  where the band is sized for the icon.
- The separation pass moves nodes the layout had placed. It corrects as little as
  it can (least penetration, split between the two boxes), but a drawing with many
  overlaps comes out less regular than the algorithm intended.
- Relaxation does not terminate exactly on a chain of
  boxes, so it aims slightly past the gap it wants and
  gives up after a bounded number of rounds. A
  pathologically crowded level can keep a sub-pixel
  overlap.
- A container's label is not truncated to its band:
  eliding it would collapse the id, label and class to
  one line. A label that wraps past three lines still
  covers the top of its children.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- The three defects, concretely:
  - `padding` was written as a CSS-style four-value
    string. Cytoscape's `padding` is a single length,
    so the declaration was rejected and silently left
    at `0`.
  - the container label used `text-valign: top` /
    `text-halign: left`, which anchor a label outside
    the node. Cytoscape derives a parent's box from its
    children, and ELK is never told a parent's size at
    all.
  - `cytoscape-elk` puts a leaf's centre at the centre
    of a slot sized with its label-inclusive box.
- The fixes: `padding` is the single number
  `containerLabelBand(prefs)`, the label is anchored
  `top-inside` / `left-inside`, and
  `labelAnchorTransform` in
  [layouts.js](../../app/src/viz/layouts.js) corrects
  the centring through the layout's `transform` hook.
- Per-container padding goes through the adapter's
  `nodeLayoutOptions`; the option ELK does inherit is
  `hierarchyHandling`.
- The separation pass is
  [separateSiblings.js](../../app/src/viz/separateSiblings.js),
  over `{ id, x1, y1, x2, y2 }` boxes. It runs on
  `layoutstop` and after a rotation.
- Relaxation aims half a pixel past the target gap and
  gives up after 20 rounds.
- The label truncation not applied is
  `text-wrap: ellipsis`.
