# 36. Location pins

Date: 2026-09-11

## Status

Accepted

## Context

Architectures need to show components' locations
to ensure:

- availability requirements;
- legal requirements.

Location classes (eg. d3f:PhysicalLocation, dpv:Location) can be associated via:

- d3f:contains (by containment)
- d3f:has-location (by an explicit edge)
- a combination of both, like (^d3f:contains*/d3f:has-location)

A d3f:DigitalArtifact is not a location - e.g., a virtual machine, or even a physical host can be moved across datacenters.

Graph panel represents:

- d3f:contains via a containment box toward Location class;
- d3f:has-location via an explicit edge;

The app needs to provide a low friction way for the reader
to identify components' location.


## Decision

- [x] **A component's location is resolved from its own `d3f:has-location` edge
  first, and inherited from its ancestors otherwise.** One walk, starting at the
  component: take the place its own location edge names; failing that, climb to
  the next ancestor and ask the same; failing that, take an ancestor that *is* a
  place. So `:a` reads `Roma` from its own edge, and `a-h1` — which states
  nothing — reads `Roma` because the rack it is in does. A host in a located rack
  is in that place, and saying so on the host is the point.

- [x] **Both ways of stating location feed the same answer.** A document nesting
  its hosts and a document drawing `d3f:has-location` arrows get the same word on
  the same node. Which one to write stays the author's choice — nesting where the
  containment is real, the edge where it is not — and the reader is not asked to
  care.

- [x] **`dpv:isOutsideOfLocation` never feeds a location.** It is a location
  *link* and classifies as one for colour and filtering, but it asserts the
  opposite of residence. Reading it as a place would put a confident wrong answer
  on a node, which is worse than the blank it replaces. It stays an ordinary
  drawn edge.

- [x] **The place is drawn with a 📍 prefix.** A marker rather than prose: the
  line sits under the node's identity and has to be told apart from it at a
  glance, and a pin is what every map has trained the reader to read as "here".

- [x] **There are two views, and a checkbox chooses between them.**
  - **Off — the complete view.** Location edges are drawn as the edges they are,
    boxes as the boxes they are. Nothing on the node. The drawing says what the
    store says.
  - **On — absorb.** The 📍 and the place name are drawn on the component, the
    `d3f:has-location` edges that produced them are **not** drawn, and a place
    left with nothing else to say is not drawn either.

- [x] **Off is the default.** The absorb view removes elements, and the default
  view is complete: a diagram is first seen as its triples describe it. This is
  the same rule the other element-changing view options follow.

- [x] **Absorbing an edge and dropping a place are two decisions, not one.**
  Every location edge is absorbed whenever the view is on, so a pin means exactly
  the same thing everywhere in the drawing and the fan-in is gone even around a
  place that has to stay. Whether the *place* is then drawn is decided
  separately, by what is left of it.

- [x] **A place is dropped only when nothing else needs it.** It has no visible
  children, nothing else points at it or from it, and the pin that replaced its
  edge is actually drawn. A place that *contains* things is a box with contents,
  and a box with contents is not redundant with a pin; a place with a link of its
  own is still saying something that link is the only way to read. So a document
  mixing both styles keeps its boxes and loses only its location arrows.

- [x] **A surviving place is drawn without its location arrows**, which is the
  price of the rule above: `:rm` can be on the canvas, `:a` can read `📍 Roma`,
  and no line joins them. The alternative — absorbing only where the place could
  also be dropped — would draw the same predicate two ways in one diagram
  depending on a property of the far end, and a reader cannot be asked to infer
  that rule from the drawing.

- [x] **The Links filter stays authoritative.** The absorb happens only while the
  `location` link kind is visible, so unticking that chip leaves edges and places
  exactly as they were. A filter a view transform can overrule is not a filter.

- [x] **An inherited location is drawn, and the checkbox says so.** `a-h1` shows
  `📍 Roma` while stating no triple about Roma — it is true of it, because the
  thing containing it said so, but a reader who goes looking in the TriG pane
  will not find a matching line. The control's tooltip warns about this. It is
  the one place the drawing knowingly says more than the text.

- [x] **Absorbing is a transliteration, not a derivation**, and that is what
  makes it safe to remove an edge. One triple becomes one pin: the same fact,
  about the same thing, naming the same place. Nothing is composed, nothing is
  invented, and the triple is still in the TriG pane unchanged.

## Consequences

Pros:

- A component says where it is even when its place is not on screen. Fold a site,
  and the hosts that were in it still read `📍 Roma`.
- A drawing with twenty components in three sites loses twenty arrows and gains
  twenty words. The arrows carried one word each and crossed the diagram to do
  it; the words are on the nodes that own them.
- The two ways of writing location — nesting and the explicit edge — become one
  thing to read.
- No new vocabulary, no new triple, no new node type.

Cons:

- An inherited pin has no triple behind it. `a-h1` reads `📍 Roma` and the TriG
  pane has no line saying so; the reader has to know that the rack above it did.
  This is the first place in the graph view where the drawing says more than the
  text, and the tooltip is the only warning.
- A place can vanish. Absorb `:a d3f:has-location :rm` and, if `:rm` had nothing
  else to say, `:rm` is no longer drawn at all — a node in the store with no mark
  on the canvas. The refusal list keeps this to the case where the pin genuinely
  replaced it, but it is still a node the reader cannot click.
- A place that survives loses the lines that explained why it is there. `:rm`
  kept for one unrelated link is drawn with that link and nothing else, while the
  components that named it show `📍 Roma` across the diagram with no line back.
  The two readings are consistent but they do not visibly meet.
- This is another view option that changes which elements exist, alongside the
  ones that already do. Each is defensible alone; with two of them on, the
  drawing is some distance from the store, and nothing on screen totals up how
  far.
- An emoji is measured badly by the label sizing, so a pinned line is slightly
  under-measured and a container's band can end up a few pixels tight.

## DONTREADME

Notes for LLM agents. They describe the code, not the decision, and go stale:
check the code before trusting them.

- **The pin is a glyph, not an icon.** A cytoscape node label is plain text, so
  an SVG cannot go in it; the icon set does contain a `PhysicalLocation` icon,
  but it is only reachable as a node `background-image`, and that slot holds the
  node's type icon. The house idiom is the fold note's — glyph, space, text
  (`▸ 3 nodes`) — composed in
  [viz/toCytoscape.js](../../app/src/viz/toCytoscape.js) and never in the
  stylesheet. `drawnLabel` in
  [viz/graphPrefs.js](../../app/src/viz/graphPrefs.js) joins lines and knows
  nothing about the marker.
- `locationOf` in [rdf/graphModel.js](../../app/src/rdf/graphModel.js) does the
  walk and returns both the display string (`node.location`) and, **only** when
  the location came from an edge on the node itself, `node.locationIri`. An
  inherited location has no IRI, because there is no edge on that node to absorb.
- The edge index it walks is built from `kind === 'location'`, which
  `classifyPredicate` in [rdf/linkKind.js](../../app/src/rdf/linkKind.js) already
  puts on every edge — the model layer does not re-test predicate names either.
  The `dpv:isOutsideOfLocation` exclusion is the one predicate named explicitly,
  and it is named in `graphModel.js`, not in the view.
- The absorb sits at step 3½ of `toCytoscapeElements`, beside the artifact-path
  collapse of [ADR 0026](0026-collapse-artifact-mediated-paths.md), and both feed
  an `absorbed(iri)` helper read by the node-emission `continue` and by
  `hasDrawnChild`. The two sets stay separate: the refusal lists differ.
- `locationPins` is in `LAYOUT_AFFECTING` in
  [viz/graphPane.js](../../app/src/viz/graphPane.js) *and* in the rebuild
  condition in [main.js](../../app/src/main.js). Only the first would leave
  absorbed edges on screen when the box is ticked.
- Defaults live in `app/src/config/viewDefaults.js`, not in `graphPrefs.js`.
