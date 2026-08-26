# 24. Draw a relation asserted both ways as one two-way link

Date: 2026-08-10

## Status

Accepted

## Decision

- [x] When the same predicate is asserted in both
  directions between the same pair of drawn nodes, the
  graph draws one link with an arrowhead at each end,
  not two arrows facing each other.

- [x] Only the *same* predicate pairs up. `:a d3f:reads :b` with `:b d3f:read-by :a` is one assertion written
  twice, not a two-way relation, and merging them would
  claim that :b reads :a. They stay two arrows.

- [x] The merge is a view transform, like folding and
  like the direction toggle: the store keeps both
  triples, the TriG pane shows both, and the link
  counter still counts both as the total.

- [x] The second head is the only thing the drawing
  says about it, so the info panel says the rest: an
  `asserted both ways` badge and a row per direction.
  `g` reaches the mermaid source of either triple, and
  a directional flow focus walks the link from either
  end — the reading must not depend on which of the two
  triples happened to be drawn as the source.

- [x] A pair whose ends were re-anchored by a fold
  merges the same way, into one dashed derived link
  standing for the child links in both directions
  ([ADR 12](0012-fold-container-nodes.md)).

## Context

A symmetric relation is written twice. Mermaid's
`<-->` emits one triple per direction
([ADR 3](0003-diagram-to-trig.md)), and
`d3f:connected-to` — the predicate a network diagram is
mostly made of ([ADR 7](0007-classify-graph-links.md))
— is its own inverse, so a hand-written graph asserts
it both ways too. The view is built from the store
alone ([ADR 14](0014-graph-view-from-rdf-only.md)) and
had no notion of a two-way link, so every such relation
drew two beziers: two labels to read, two arrowheads
pointing at each other, and two elements to click
before finding out they say the same thing. In
`002-network.md` that is every link in the diagram.

Nothing was wrong about it — both triples are in the
store, and drawing what the store holds is the rule
this view is built on. But an arrow is read as a
direction, and a pair of opposed arrows is read as two
directions, which is exactly what a symmetric relation
does not have.

## Consequences

Pros:

- A network diagram reads as a topology instead of as a
  crowd of opposed arrows, and its edge labels halve.
- The two-way relation is stated by the drawing rather
  than inferred by noticing the second arrow behind the
  first.
- Selecting the link selects the relation. There is no
  longer a second element saying the same thing that a
  click can land on instead — which also settles
  `reselectEdge`'s unordered-endpoint match, whose two
  candidates were exactly this pair.

Cons:

- Shown and total link counts now differ for a reason
  the chips do not explain, on top of the filter and
  the fold.
- `s` still swaps per predicate and a two-way link has
  nothing to swap, so pressing it on one appears to do
  nothing.
- Two elements became one, so a per-element view state
  keyed by edge id — none today — would have to decide
  which of the two triples it belongs to.

## DONTREADME

Notes for LLM agents. They describe the code as it is,
not the decision, and go stale: check the code before
trusting them.

- The merge is step 3c of `toCytoscapeElements` in
  [app/src/viz/toCytoscape.js](../../app/src/viz/toCytoscape.js).
  It works on the `baseId` groups of step 3b, looking up
  `` `${target}->${source}:${predicateLabel}` `` and
  consuming that group. The written CURIEs must match:
  the drawn label alone cannot tell two predicates apart
  once an inverse name is on screen.
- Pairing between two groups is index-wise, because a
  relation asserted in two visible named graphs is two
  parallel edges (`rdf/graphModel.js`). Two one way and
  one the other draws one two-way link and one one-way
  link.
- The flag is `data.bidirectional`, matched by
  `edge[bidirectional]` in
  [app/src/viz/graphStyle.js](../../app/src/viz/graphStyle.js),
  which sets `source-arrow-shape` only. `source-arrow-color`
  is set unconditionally on the base `edge` rule and on
  the tactical-verb one, so the kind rules keep owning
  the colour.
- `foldedFrom`/`foldedTo` stay the endpoints *as drawn*,
  so a reciprocal member contributes its `toIri` to the
  source end. `edgePanelSummary` lists both cross
  products for a two-way derived link, and
  `writtenTriplesOf` ([app/src/goToSource.js](../../app/src/goToSource.js))
  collects both orientations.
- `directionalFlow` ([app/src/viz/pathFocus.js](../../app/src/viz/pathFocus.js))
  registers a two-way edge in both adjacency maps;
  `graphPane` passes the flag through when it builds the
  edge list.
