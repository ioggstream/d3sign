# 44. Compound icons for nodes with several classes

Date: 2026-10-08

## Status

Accepted

Amends [ADR 0015](0015-graph-visualization-preferences.md).

## Context

D3FEND names only some of the combinations an
architecture needs. It has
`d3f:DatabaseServiceApplication`,
`d3f:DHCPServiceApplication` and
`d3f:AuthenticationServiceApplication`, but nothing for
a code repository served over the network. Such a node
has to say so with two classes:

```text
forge["d3f:ServiceApplication d3f:CodeRepository"]
```

Both reached the RDF — `rdf/emit.js` writes one
`rdf:type` per class — and both showed in the info
card. The drawing did not: `rdf/graphModel.js` set
`rdfType` from `types[0]` and the icon resolved from
that alone, so the second class was invisible in the
diagram.

### Author order is not available

The obvious rule, *the first class you typed is the
one that leads*, cannot be implemented.
`buildGraphModel` reads types from the N3 store, and
`N3Store._findInIndex` walks its index by numeric term
id, assigned at a term's first mention anywhere in the
store. A node's `rdf:type` order is therefore global
first-mention order across the whole document, not the
node's own source order: an unrelated earlier line
naming `d3f:CodeRepository` would silently change
which class drew this node.

Carrying author order into the view would mean putting
it in the RDF, which
[ADR 0014](0014-graph-view-from-rdf-only.md) rules out
— and it would say nothing for a document imported
from Turtle ([ADR 0009](0009-direct-rdf-import.md)),
where there is no author order at all.

`rdfType` already inherited this; the feature would
have made it visible.

### The tint was breaking the icons it was given

The icon set ships twelve icons that are already
compound, built by its own
`scripts/build.mjs`: a `<mask>` punches the overlay's
silhouette, plus a stroked halo, out of the base. The
mask's group carries `color="black"`, and the overlay's
paths carry `fill="currentColor"` — the silhouette is
black *only because* `currentColor` resolves against
that group.

`iconDataUri` tinted by `body.replaceAll('currentColor', color)`. That rewrote the mask's paths too, leaving
`color="black"` nothing to act on. The mask then
rendered at the tint's luminance — about 0.11 for a
red — so the cut-out was 89% opaque instead of a hole,
and the base bled through the badge. `d3f:DatabaseServer`
and friends have been drawing a crisp black halo around
a ghosted badge ever since they were added.

## Decision

- [x] The tint is `color` on the root `<svg>`, not a
  substitution of the string `currentColor`. `color` is
  inherited, so the body still resolves to the tint —
  but a subtree that sets its own `color`, like a
  cut-out mask, keeps it. This repairs the twelve
  existing compound icons as well as enabling the new
  ones, and it makes composition independent of
  tinting.

- [x] A node with several D3FEND classes is drawn as
  the glyph of the specific thing it is, badged in the
  bottom-right corner with what it is served or hosted
  as, composed at render time in `viz/icons.js` from
  bodies the icon set already publishes. Nothing is
  added to
  [d3fend-icons](https://github.com/ioggstream/d3fend-icons),
  and no SVG is authored in this repository.

  `d3f:ServiceApplication d3f:CodeRepository` is
  therefore a code repository badged as an application,
  which is how the icon set composes the combinations
  it *does* name:
  `DatabaseServiceApplication` is
  `mdi:database_{mdi:application-outline}` and
  `MailService` is
  `mdi:email_{mdi:cog-transfer-outline}` — the generic
  "served as" glyph is the overlay in both.

- [x] Geometry and markup are upstream's
  `buildCompoundIcon` to the last float — same scale,
  margin and cut-out stroke — so an icon the set ships
  ready-made and one composed here are the same
  picture.

- [x] Which class badges which is decided by
  `BADGE_CLASSES` in `viz/icons.js`: an ordered list of
  what a node is *served or hosted as*. Matching is
  inherited, so `d3f:DatabaseServiceApplication` ranks
  via `d3f:ServiceApplication` without being named.
  Classes are ordered by that rank, then general before
  specific, then by name; the first becomes the badge
  and the second draws the glyph.

  This is the list to edit when a diagram badges the
  wrong way round. It is a list of classes rather than
  of pairs because the combinations are open-ended and
  the things that host them are not.

- [x] The list **ranks, it does not gate**. A node whose
  classes all match it still gets a compound icon. The
  first implementation required exactly one class to
  match, which looked right on
  `ServiceApplication` + `CodeRepository` and silently
  failed on half of everything else: the list matches
  by inheritance, and `ComputerPlatform`,
  `Application` and `Software` sit near the top of
  their subtrees, so most of D3FEND descends from one
  of them. `Host` + `WebServer`, `Process` + `Browser`
  and `ServiceApplication` + `MailService` all matched
  twice and drew a single icon.

- [x] Classes are deduplicated on the *resolved icon*,
  not on the class name. The set is small and
  resolution walks up the hierarchy, so two classes
  often land on the same ancestor icon — a glyph must
  never be stamped on itself as its own badge.

- [x] One badge. A third class and beyond are ignored
  by the icon; they still show in the info card and in
  the node's type line.

- [x] Nothing to compound — one class, no base, no
  qualifier, or two classes resolving to one icon —
  renders exactly as before.

## Consequences

### Pros

- A node can say it is two things and be drawn as
  both, without waiting for D3FEND to name the
  combination.
- Independent of the order the classes are written in,
  and of what other nodes in the document mention
  first.
- The existing compound icons stop ghosting.
- `data.typeName` and the `node[typeName]` selectors
  are untouched: `typeNames` is extra data, set only
  when there is more than one class, so single-class
  nodes render byte-identically.

### Cons

- The **mermaid preview will not show the badge**. It
  registers the icon set with
  `mermaid.registerIconPacks` and draws only what the
  author wrote as `@{icon: …}`; type-driven resolution
  has never applied there
  ([ADR 0003](0003-diagram-to-trig.md)). The two panes
  therefore differ for a multi-class node.
- `BADGE_CLASSES` is a judgement call that lives in this
  repository and will need extending as diagrams grow.
  When it ranks two classes equally the hierarchy
  decides, which is defensible but not always what the
  author meant.
- A 0.6-scaled badge inside a small node at low zoom is
  a smudge. `nodeSize` is a user preference with a wide
  range.
- Composition reads markup this app does not own —
  `withScopedIds` and the geometry constants both
  assume the upstream builder's output. Both degrade to
  a plain base icon rather than throwing.

### DONTREADME

**Do not substitute the string `currentColor` in an
icon body.** The tint must stay a `color` property on
the root. A compound icon's cut-out mask works by
shadowing that property with its own `color="black"`;
rewriting the string takes away the thing it shadows
and turns the hole into a ghost. `app/test/icons.test.js`
guards this.

**Do not assume `node.types` is in source order.** It
is in the N3 store's global term-interning order. Any
rule that reads it must be order-independent, or it
will change behaviour when an unrelated line moves.

**Ids must be scoped when a body is copied.** The
overlay is emitted twice — once for the cut-out, once
for the drawn badge — and an already-compound overlay
brings its own `<mask id="compound-mask-…">` into both
copies. Duplicate ids are not an SVG error: the browser
resolves `url(#x)` to the first in document order,
which is the copy inside the mask. They happened to be
identical before the tint fix; they are not now.
