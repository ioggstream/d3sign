# 36. Represent a component's location

Date: 2026-09-11

## Status

Accepted

Supersedes [ADR 0032](0032-rejected-cytoscape-container-node-by-relation.md).

## Context

Architectures need to show components' locations
to ensure:

- availability requirements;
- legal requirements.

Location classes (eg. `d3f:PhysicalLocation`,
`dpv:Location`) can be associated via:

- `d3f:contains` (by containment)
- `d3f:has-location` (by an explicit edge)
- a combination of both, like
  (`^d3f:contains*/d3f:has-location`)

A `d3f:DigitalArtifact` is not a location - e.g., a
virtual machine, or even a physical host can be moved
across datacenters.

Graph panel represents:

- `d3f:contains` via a containment box toward Location
  class;
- `d3f:has-location` via an explicit edge;

The app needs to provide a low friction way for the
reader to identify components' location.

Neither representation provides it on its own.

A box answers only while it is on screen. Fold it,
scroll away, or draw the component in a diagram its
place is not in, and the answer is gone.

An edge answers, but expensively. Twenty components in
three places is twenty arrows converging on three
nodes, crossing everything else on the way. Each one
carries a single word, and the reader traces a line to
read it.

Neither groups. A reader asking what is in a given
place traces edges, or reads components one at a time.
Grouping is what a box does, and a box is already
understood here, because nesting already means place.

[ADR 0032](0032-rejected-cytoscape-container-node-by-relation.md)
refused to draw a box from a relation, on four
grounds. One of them still applies and three do not.

A compound node is a tree, so a component already
inside a box has no parent left to give. That ground
stands, and is accepted below rather than solved.

Transitivity does not apply. A location box does not
claim `d3f:has-location` composes; it claims a place
holds what is in it, which is what a place is.

The arithmetic does not apply either. The refused
feature drew one box per predicate a diagram happened
to use. This draws boxes only for places, a closed and
small set in any drawing.

Accepting that containment wins leaves a gap. A
component inside one thing may name a place that thing
is not in. That is a contradiction in the model rather
than a rendering choice, and nothing reports it.

Alternatives considered:

- A marker pinned to a component's corner. No
  convention draws one: cloud and architecture
  notations all nest, and the corner label they do
  define belongs to the group box, not to its members.
- Let a stated place win the parent. The box view
  would then work on nested drawings, at the cost of
  moving a component out of the box its own
  containment statement puts it in.
- Report the contradiction as a library query. The
  library already holds validation questions, but it
  is long, and a reader has to think to run it.

## Decision

- [x] A component's location is resolved from its own
  location edge first, and inherited from the things
  containing it otherwise.
- [x] Both ways of stating location resolve to the
  same answer. Which one to write stays the author's
  choice, and the reader is not asked to care.
- [x] An edge asserting that a component is outside a
  place never resolves to a location. It stays an
  ordinary drawn edge.
- [x] Location has three views, and one is chosen at a
  time: the edges as drawn, a marker on the component,
  or a box around it.
- [x] The two drawn views remove the edges they
  replace. One statement, one representation.
- [x] The edges view MUST be the default. The other
  two change which elements are drawn, and a drawing
  is first seen as its triples describe it.
- [x] In the marker view, a place left with nothing
  else to say is not drawn. A place that holds
  something, or that carries an edge of its own, is
  kept.
- [x] Absorbing an edge is a transliteration, not a
  derivation, which is what makes removing it safe.
  One statement becomes one mark, about the same
  component, naming the same place.
- [x] In the box view, containment wins the parent. A
  component already inside something is never moved
  into a location box.
- [x] Only a component's own statement places it in a
  box. An inherited place never does, or a descendant
  would become a sibling of its own ancestor.
- [x] A box MUST NOT be drawn where it would make a
  component its own ancestor.
- [x] A component whose stated place disagrees with
  the place of the thing containing it MUST be
  reported to the author.
- [x] The report names both components and both
  places. Which of the two statements is wrong is the
  author's to decide.
- [x] A container that names no place contradicts
  nothing and is not reported. Silence is not
  disagreement.

## Consequences

Pros:

- A component says where it is even when its place is
  not on screen.
- A drawing with many components in few places loses
  the arrows that each carried one word, and gains the
  word on the component that owns it.
- A reader sees what is in a place by looking at one
  box, which neither other view offers.
- The box keeps meaning what it always meant: the
  thing around holds the things inside.
- A contradiction that was silent is reported, and
  detecting it costs nothing beyond a walk that
  already runs.
- No new vocabulary, no new triple, no new node type.

Cons:

- An inherited mark has no statement behind it. It is
  true of the component, because the thing containing
  it said so, but a reader checking the triples finds
  no matching line. This is the one place the drawing
  knowingly says more than the text.
- A place can vanish in the marker view. The refusal
  list keeps that to the case where a mark genuinely
  replaced it, but it is still a node the reader
  cannot click.
- A place kept for an unrelated edge is drawn without
  the edges that explained why it is there, while the
  components naming it carry marks with no line back.
  The two readings are consistent but do not meet.
- The box view does nothing on a drawing that already
  nests, which is the style the corpus prefers.
  Containment wins, so there is nothing left to group.
- A box is drawn from a statement that does not say
  "contains", so what a box means is wider than it
  was, for the third time.
- Three views are three things to explain, and the two
  useful ones are both off by default.
- A marker is measured badly by the label sizing, so a
  marked line is slightly under-measured and a
  container's band can end up a few pixels tight.

## DONTREADME

Notes for LLM agents. They describe the code, not the
decision, and go stale: check the code before trusting
them.

- The view option is `locationView` in
  `app/src/config/viewDefaults.js`, one of
  `LOCATION_VIEWS` (`off`, `pins`, `boxes`) in
  `app/src/viz/graphPrefs.js`, validated in
  `normalizePrefs` beside `NODE_STYLES` and
  `LABEL_DETAILS`. It replaced the `locationPins`
  boolean, which replaced `showLocation`;
  `normalizePrefs` migrates both, reading them off the
  raw payload because the defaults have already filled
  the key in by the time they are merged.
- A string, not two booleans, and not by taste: a
  location box gives the place a visible child, which
  is the condition that stops `absorbLocationLinks`
  dropping a place, so a combined state would draw the
  box and the marker and no edge between them.
- `locationOf` in `app/src/rdf/graphModel.js` walks
  `parentOf` and returns `{ label, iri, conflict }`.
  `iri` is set only for a node's own edge, and it is
  what both drawn views key on. The walk carries on
  past its own answer to find a disagreeing ancestor.
  `locationEdgeTargets` beside it keys on
  `edge.kind === 'location'` and names
  `dpv:isOutsideOfLocation` as the one exclusion.
- The marker is a glyph, composed in
  `app/src/viz/toCytoscape.js` the way `foldNote`
  composes its own. A cytoscape label is plain text,
  so an icon cannot go in it; the icon set does hold a
  `PhysicalLocation` icon, but it is reachable only as
  a node `background-image`, and that slot holds the
  node's type icon. `drawnLabel` in
  `app/src/viz/graphPrefs.js` joins lines and knows
  nothing about the marker.
- Parenting stays out of the model. `buildGraphModel`
  takes no view option, per
  [ADR 0014](0014-graph-view-from-rdf-only.md).
  `locationContainment` in
  `app/src/viz/toCytoscape.js` returns augmented
  copies of `containment` and `parentOf`, shadowing
  the destructure at the top of `toCytoscapeElements`,
  so `visibleParentOf`, `representativeOf`,
  `hasVisibleChild` and `hasDrawnChild` need no
  change. Never mutate the model: it is cached across
  renders.
- The cycle guard has no precedent and is required.
  A component containing a place and also naming it
  would parent each to the other. `visibleParentOf`
  does not catch that: its `seen` set guards only hops
  over hidden parents. Neither does
  `separateSiblings`, whose `siblingLevels` walks from
  `cy.nodes().orphans()`, and a cycle has no orphan,
  so the pass stops running in silence.
- Absorbing runs for both drawn views, and
  `absorbLocationLinks`' own refusal list keeps a
  place that has become a box, with no special case.
- `locationView` belongs in `LAYOUT_AFFECTING` in
  `app/src/viz/graphPane.js` and in the rebuild
  condition in `app/src/main.js`. Only the first would
  leave absorbed edges on screen when the view
  changes.
- `buildGraphModel` returns the contradictions as
  `warnings`. `app/src/main.js` calls `showLint` after
  `applyGraphVisibility` rather than before, so they
  join the parser's own.
