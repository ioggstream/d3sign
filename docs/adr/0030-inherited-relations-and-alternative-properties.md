# 30. A relation stated on a superclass is a relation of the class

Date: 2026-09-02

## Status

Accepted

## Context

Selecting an artifact showed no relations. Not few —
none. `d3f:WebServerApplication` listed nothing at all,
while `d3f:Application` above it states
`may-contain ApplicationConfiguration` and
`d3f:Software` above that states three more.

D3FEND states almost nothing on a leaf class. 2160 of
the 3655 classes in the metadata projection carry no
relation row, and 1201 of those have ancestors that
do. The panel was reading the projection directly, and
the projection is indexed per class with no
`rdfs:subClassOf*` closure, so a class inherited
nothing.

Domain and range cannot help. Only 6 of D3FEND's 219
object properties declare an `rdfs:domain` and 8 an
`rdfs:range`; applicability lives instead in 1787
`owl:Restriction` axioms spread over 1303 classes, plus
the relations stated as plain triples.

The same gap has a second face. Given a link already
drawn between two nodes, nothing said which other
predicate could have carried it — and the answer is
almost always stated on a superclass of one end, so it
was exactly as invisible.

Alternatives considered: materializing the closure into
the projection at build time, and asking the SPARQL
engine at panel-open time. Both are rejected below.

## Decision

- [x] **A relation stated on a superclass is a
  relation of the class.** The node panel lists what
  the class's ancestors state as well as what it
  states itself, so a leaf class stops reading as a
  class D3FEND says nothing about. The panel gets
  busier; that is the cost of it being complete.

- [x] **The class a relation is stated on is named
  once, over the group of relations it states.** "Because
  it is Software" is the whole answer to why a row is on
  screen, and without it an inherited row is
  indistinguishable from a direct one. It is not said
  per row: it qualifies the *subject* — it is the class
  `this` stands for — so said on the row it reads as a
  property of the link, which it is not.

- [x] **A relation is drawn as the triple it is:
  subject, predicate, object, arrow pointing along
  it.** The two ends already swap according to the
  relation's direction, so a glyph that swapped too was
  the same fact twice — and the two disagreed, leaving
  an outgoing row saying the partner acts on this node.

- [x] **What the class states itself is separated from
  what it inherits, and each superclass's group is
  folded.** Collapsed by default, but the heading always
  names the superclass and counts its rows: 1201 classes
  state no relation of their own, so a fold that hid the
  count would put those panels back to looking empty,
  which is the first decision above. Inherited rows
  reach 107 for one class and a median of 4, across a
  median of 3 superclasses.

- [x] **The hierarchy is walked at query time, not
  baked into the projection.** Materializing the
  closure turns 3154 rows into 30643, on a file already
  2.0 MB, for a walk that costs nothing: ancestors per
  class run to a median of 7 and a maximum of 15, and
  the result is memoised per class.

- [x] **The walk follows every parent.** The existing
  ancestor helper follows only the first, which is
  right for the display path it feeds and wrong here:
  504 classes have more than one parent, and taking the
  first silently drops the branch the relation is
  stated on.

- [x] **An edge's info panel lists the other
  predicates that could connect its two ends**, each
  naming the class whose axiom licenses it, and marking
  the one already drawn. That row is the answer to "why
  is this link legal", which the panel could not
  previously give.

- [x] **A predicate stated on the object end is an
  alternative too.** It is the same arrow written the
  other way round —
  `d3f:WebServerApplication -> d3f:Process` is licensed
  by `d3f:instructs` going out and `d3f:instructed-by`
  coming in — so the list is one question with a
  direction, not two lists.

- [x] **Two tiers, and the loose one is a query
  edit.** A candidate is offered when the far end
  matches the axiom's filler, or when the filler is
  below it, and the second case is marked. Relaxing
  that to "licensed on one end, other end
  unconstrained" reaches 108 rows for a single class,
  so it is a documented two-line deletion in the query
  rather than a control in the panel.

- [x] **The list is read-only, and lives in the
  existing modal.** [ADR 0019](0019-select-and-swap-edges.md)
  made a single click on an edge stop mutating the
  diagram; an anchored popover carrying Apply buttons
  would put a write one stray click from a selection
  click. Applying a candidate is also a *per-edge*
  rewrite, while the swap beside it is per-predicate
  and global, and two scopes one click apart is the
  surprise that ADR removed.

- [x] **The panel computes from the projections, not
  from SPARQL.** The modal is synchronous and the
  ontology is a lazily fetched 400 KB, so the first
  double-click would pay a download. The query is
  offered as a button instead — the escape hatch, not
  the mechanism.

- [x] **The equivalent SPARQL ships as a library
  query, and the shell writes the pair into its
  text.** The user asked to see the query in order to
  try other tiers, so the query that runs is the query
  they read and edit.

- [x] **The pair is substituted, not bound with
  `VALUES`.** This is the one place the `?this`
  mechanism of [ADR 0021](0021-sparql-query-pane.md)
  cannot be reused: a variable inside
  `rdfs:subClassOf*` defeats oxigraph's planner, and
  the query that answers instantly with the classes
  written in ran over two minutes without finishing
  when they arrived through a trailing `VALUES`.

- [x] **The query reads the materialized triples
  rather than re-walking the restrictions**, which is
  what [ADR 0020](0020-sparql-query-engine.md) already
  decided and this query now benefits from twice over:
  it is five lines shorter, and it covers 4319
  candidate relations against 1787, because D3FEND
  states many of its relations only as plain triples.

- [x] **The query is narrowed to the same curated set
  the panel sees.** Two exclusions, both already
  implicit in the projection: the object properties
  that carry metadata rather than a drawable link
  (`d3f:enables` is technique to tactic and feeds the
  kill-chain badges), and a filler at the root of the
  hierarchy, which every class matches and which is
  therefore an "alternative" between any two nodes at
  all.

- [x] **A candidate is shown as the axiom it comes
  from**, subject and far end included, not as a
  predicate alone. A predicate alone is not unique:
  `d3f:accesses` is stated on
  `d3f:NetworkResourceAccess` twice with two different
  far ends, and two rows with nothing to tell them
  apart are worse than one.

- [x] **The two implementations are held to one
  answer.** The panel's walk and the shipped query are
  run against the real ontology and compared, because
  a panel that disagrees with the query button beside
  it is the failure this design invites. Both
  exclusions above, and the grouping the duplicate rows
  needed, were found by that comparison rather than by
  reasoning.

## Consequences

Pros:

- The reported symptom is gone at its source, for
  every class at once rather than for artifacts: 1201
  classes that listed nothing now list something.
- An inherited row says where it comes from, so the
  fix is legible rather than merely larger. Grouped
  under that superclass, the panel answers a question
  the flat list could not: what is true of this node
  *as* a firewall, as against as a computer platform.
- One rule now covers both panels — ends in the order
  the triple states them, the arrow along it, anything
  else a badge — which is what caught the same
  inverted-arrow bug in the edge panel's own rows.
- "Why is this link legal, and what else could carry
  it" is answerable from the drawing, which needed the
  ontology and a hand-written query before.
- Two planner traps are recorded with the query that
  hit them, so the next query over the class hierarchy
  does not rediscover them.
- The projection does not grow, and nothing new is
  fetched to open a panel.

Cons:

- A leaf class now shows a stack of folds rather than a
  stack of rows: five for
  `d3f:WebApplicationFirewall`, one per superclass that
  states anything. Compact, but reading everything a
  class can do is five clicks, and the fold state is
  gone on reopen because the dialog body is rebuilt.
- The fold is collapsed on every open, so a reader who
  wants inherited relations by default cannot have
  that. It is deliberately not a persisted preference —
  a per-node question does not belong in a global
  setting — which means there is no way to ask for it.
- The tiers are the panel's judgement, not the
  ontology's. A candidate the reader wants may be one
  the panel filtered out, and finding it means editing
  a query.
- Read-only leaves the last step manual: the panel
  names the predicate to use and the reader retypes it
  in the mermaid source.
- The walk and the query are two implementations of
  one question. They are tested against each other,
  which makes drift loud rather than impossible.
- Nothing distinguishes a relation D3FEND states as a
  restriction from one it states as a plain triple.
  Both are relations, but the distinction is now
  unrecoverable from the panel.
- The metadata-predicate exclusion is a list in two
  places — the build script and the query — and
  nothing makes them agree. A predicate added to one
  is a silent divergence until the parity test happens
  to reach a pair that uses it.
- The query is no longer the plain question it was.
  Two filters and a `GROUP BY` are there to match the
  panel rather than to answer anything, and a reader
  widening the tiers has to leave them alone.

## DONTREADME

Notes for LLM agents. They are kept out of the
sections above because [ADR 0001](0001-use-adr.md)
puts implementation detail outside an ADR. They
describe the code as it is, not the decision, and go
stale: check the code before trusting them.

- `app/src/editor/d3fendRestrictions.js` is the whole
  closure layer: `getAncestors`, `isSubClassOf`,
  `relationsFor` and `alternativesBetween`. Pure, no
  DOM, reads only `data/d3fend-metadata.json` and (via
  `getParents`) `data/d3fend-completions.json`. Two
  memo caches, keyed by class.
- It lives in `editor/` beside `d3fendHierarchy.js`,
  whose `getParents` it walks, not in `rdf/`: it reads
  the projections, not the store.
- Classes are bare local names here, because that is
  what `d3fend-metadata.json` is keyed by.
  `d3fendHierarchy.js` is qname-keyed, so
  `qnameOf`/`localNameOf` bridge the two.
- `getAncestorPath` in `d3fendHierarchy.js` is the
  first-parent walk and is still correct for the hover
  card's display path. Do not "fix" it to match
  `getAncestors`; they answer different questions.
- `via` means two different things in the two panels,
  and conflating them is what produced the unreadable
  row this ADR was amended for. `relationsFor`'s `via`
  is always *subject-side*: the ancestor of the panel's
  own node, the end `this` stands for. The `via` from
  `alternativesBetween` is whichever end the axiom is
  declared on, and the `in` branch makes that the
  target's ancestor. The node panel puts its `via` in a
  group heading; the edge panel puts its own in the
  row's first chip, because there it *is* an end of the
  drawn axiom.
- `groupByAncestor` in `viz/nodePanel.js` is the
  own/inherited split, beside `groupRelations`, and is
  keyed by a Map rather than an object literal so a
  class named `constructor` cannot collide with
  `Object.prototype`. `renderInheritedGroup` is the
  fold: `hidden` on the list plus `aria-expanded` on a
  `.node-panel-more` button, toggled in place because
  `renderNodePanel` rebuilds the modal and would close
  every other fold. `.node-panel-inherited-toggle` in
  `styles/app.css` only tightens `.node-panel p`'s
  bottom margin, which otherwise reads as a gap between
  the toggle and the list it opens.
- `alternativeBadges` in `viz/edgePanel.js` exists so
  the badge set is assertable — the row around it is
  DOM and the suite has no jsdom. `written the other
  way` is a badge and not an arrow direction on
  purpose: see the `via` note above.
- `alternativesBetween` reads only `direction: 'out'`
  metadata rows, in *both* branches. The `in` rows are
  the same statements indexed from the other end
  (`restrictions_by_object` in
  `app/scripts/build-d3fend-metadata.py`), so reading
  both would return every candidate twice.
- A property whose two ends are the same class is
  found by both branches — `d3f:may-contain` on
  `d3f:File -> d3f:File`. The dedupe on
  `predicate|via|filler` keeps the `out` row. The
  `.rq` needs `GROUP BY ?property ?via ?filler` with
  `MIN` over the branch and tier literals to agree; a
  bare `SELECT DISTINCT` splits on `?direction` and
  returns that axiom twice, which is what the parity
  test caught.
- The sort is explicit about `out` before `in` and
  `exact` before `narrower`: both would lose to
  `localeCompare`. The `.rq` gets the same order — and
  the same `MIN` — from the `1-`/`2-` prefixes on its
  literals, which is the only reason they are
  numbered. The parity test strips them.
- `edgePanelSummary` takes the candidates as a second
  argument and stays a pure function; `main.js`
  resolves the two classes from `currentModel.nodes`
  (`d3fClassOfNode`) because `app/src/viz/` may not
  reach the RDF layer (ADR 0014). `edgeAlternatives`
  returns `[]` for a collapsed path, and
  `renderEdgePanel` skips the section entirely for one.
- `edgePanelActions` now returns the query action
  unconditionally and adds `onGoToSource` only when
  the edge has a single source line. Returning `{}`
  early, as it used to, would have dropped both.
- `bindClassPair` and `PAIR_PLACEHOLDERS` are in
  `app/src/query/resultModel.js` beside
  `bindSelection`. The placeholders are
  `d3f:SourceClass` / `d3f:TargetClass` — prefixed
  names, so the file is valid SPARQL unsubstituted and
  simply matches nothing.
- `scope: pair` is a new value of the `.rq` metadata
  key. `parseQueryDoc` needs no change for it, but the
  library `<select>` handler in `main.js` special-cases
  it to say where the real pair comes from, since an
  empty result reads as "no findings" (ADR 0020).
- `test/alternative-links-query.test.js` gunzips
  `app/public/kg/d3fend.ttl.gz` and skips when it is
  absent, the arrangement `legal-kg-live.test.js` uses.
  It is the parity test; `test/d3fend-restrictions.test.js`
  holds the measured cardinalities.
- Two engine quirks the query is shaped around, both
  found the hard way. A variable inside
  `rdfs:subClassOf*` makes oxigraph plan badly enough
  to hang. And `BIND(IF(EXISTS {...}))` does not
  correlate the outer `?filler` here — it labelled
  every row exact, including
  `d3f:contains d3f:ProcessImage` for a `d3f:File`
  target. The tier must come from a `UNION`.
