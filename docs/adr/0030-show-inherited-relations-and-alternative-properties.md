# 30. Show inherited relations and properties

Date: 2026-09-02

## Status

Accepted

## Context

Selecting an artifact may show no relations. Many
D3FEND classes have only inherited ones, and the node
panel read a metadata projection indexed per class,
with no subclass closure.

Domain and range cannot stand in. Almost no D3FEND
property declares either; what a relation applies to
is stated in restriction axioms spread over the
hierarchy, and in plain triples.

The same gap hides alternatives. Nothing said which
other predicate could have joined two linked nodes,
because that is stated on a superclass too.

Alternatives considered: materializing the closure into
the projection at build time, and asking the SPARQL
engine when the panel opens. Both are rejected below.

## Decision

- [x] Show the relations a class inherits from its
  parents, not only its own. The panel gets busier;
  being complete is worth it.
- [x] Name the class a relation comes from once, above
  the group it heads. It describes the class, not the
  link, so it does not belong on every row.
- [x] Keep a class's own relations apart from the
  inherited ones, and fold each parent's group. The
  heading names the parent and counts its rows, so a
  folded group never looks empty.
- [x] Draw a relation the way it reads: subject,
  predicate, object, arrow pointing the same way. Both
  panels follow this rule. The two ends already swap
  when the direction changes, so an arrow that swapped
  as well could contradict them.
- [x] Walk the hierarchy when the panel opens, and
  follow every parent. Precomputing it makes the data
  file ten times bigger, for a walk that is cheap and
  cached; following only the first parent quietly hides
  the relations on the others.
- [x] On an edge, list the other predicates that could
  join the same two nodes, say which class allows each
  one, and mark the one in use. A predicate pointing
  the other way counts too: it is the same link written
  backwards.
- [x] Offer a predicate when the far node is the class
  the rule asks for, or a subclass of it, and mark the
  second case. Dropping that check returns far too
  much, so it stays an edit to the query.
- [x] Show a candidate with both ends, not the
  predicate alone. The same predicate can be allowed
  twice with different far ends, and rows that look
  identical help nobody.
- [x] Keep the list read-only, inside the existing
  dialog, built from the same data the panel already
  has. [ADR 0019](0019-select-and-swap-edges.md)
  stopped a single click from changing the diagram, and
  a button here would change one edge while the swap
  next to it changes every edge. Asking the ontology
  instead would make the first double-click wait for a
  download.
- [x] Ship the same question as a SPARQL query, with
  the two classes written into it, so readers can run
  and widen what they read.
- [x] Check the panel and the query against the real
  ontology, so they cannot drift into two answers.

## Consequences

Pros:

- The symptom is fixed for every class, not only for
  artifacts.
- An inherited row names the class it comes from, so
  the panel shows what is true of a node *as* a
  firewall, as against as a computer platform.
- One direction rule for both panels, which is what
  caught the inverted arrows in the edge rows.
- The drawing now answers why a link is legal and what
  else could carry it, which took the ontology and a
  hand-written query before.
- The data file does not grow, and nothing new is
  fetched to open a panel.

Cons:

- A leaf class now shows folds instead of rows.
  Compact, but reading everything takes a click per
  parent, and the folds reopen collapsed. That is
  deliberately not a saved preference, so a reader who
  wants them open cannot ask for it.
- Which candidates appear is the panel's judgement, not
  the ontology's, so finding one it filtered out means
  editing a query.
- Read-only leaves the last step manual: the panel
  names the predicate and the reader retypes it in the
  mermaid source.
- The walk and the query are two implementations of one
  question. Testing them against each other makes drift
  loud rather than impossible.
- The panel does not say whether a relation comes from
  a restriction or a plain triple.
- The predicate exclusions are duplicated between the
  build script and the query, and nothing makes them
  agree.
- The query is no longer the plain question it was: two
  filters and a grouping are there to match the panel
  rather than to answer anything.

## DONTREADME

Notes for LLM agents. They are kept out of the sections
above because [ADR 0001](0001-use-adr.md) puts
implementation detail outside an ADR. They describe the
code as it is, not the decision, and go stale: check
the code before trusting them.

Projection figures re-measured on D3FEND 1.6, and
asserted in `test/d3fend-restrictions.test.js`: 2188 of
the 3688 classes in the projection carry no relation
row, 1229 of those have ancestors that do; the closure
would turn 3162 rows into 31008 in an already 2.0 MB
file; ancestors per class run to a median of 7 and a
maximum of 15; 514 classes have more than one parent;
inherited rows reach 107 for one class, median 4 over a
median of 3 superclasses (5 folds for
`d3f:WebApplicationFirewall`). The ontology figures are
still the 1.5 measurement: 6 of 219 object properties
declare an `rdfs:domain` and 8 an `rdfs:range`, against
1787 `owl:Restriction` axioms over 1303 classes;
the loose tier reaches 108 rows for a single class; the
query covers 4319 candidate relations against the 1787
restrictions, because D3FEND states many relations only
as plain triples; the ontology is a lazily fetched
400 KB.

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
  DOM and the suite has no jsdom. `written the other way` is a badge and not an arrow direction on
  purpose: see the `via` note above.
- `alternativesBetween` reads only `direction: 'out'`
  metadata rows, in *both* branches. The `in` rows are
  the same statements indexed from the other end
  (`restrictions_by_object` in
  `app/scripts/build-d3fend-metadata.py`), so reading
  both would return every candidate twice.
- A property whose two ends are the same class is found
  by both branches — `d3f:may-contain` on
  `d3f:File -> d3f:File`. The dedupe on
  `predicate|via|filler` keeps the `out` row. The `.rq`
  needs `GROUP BY ?property ?via ?filler` with `MIN`
  over the branch and tier literals to agree; a bare
  `SELECT DISTINCT` splits on `?direction` and returns
  that axiom twice, which is what the parity test
  caught.
- The sort is explicit about `out` before `in` and
  `exact` before `narrower`: both would lose to
  `localeCompare`. The `.rq` gets the same order — and
  the same `MIN` — from the `1-`/`2-` prefixes on its
  literals, which is the only reason they are numbered.
  The parity test strips them.
- The query's two exclusions are the object properties
  that carry metadata rather than a drawable link
  (`d3f:enables` is technique to tactic and feeds the
  kill-chain badges) and a filler at the root of the
  hierarchy, which every class matches. `d3f:accesses`
  on `d3f:NetworkResourceAccess` is the duplicate pair
  that forced the axiom-shaped row: stated twice with
  two different far ends.
- `edgePanelSummary` takes the candidates as a second
  argument and stays a pure function; `main.js` resolves
  the two classes from `currentModel.nodes`
  (`d3fClassOfNode`) because `app/src/viz/` may not
  reach the RDF layer (ADR 0014). `edgeAlternatives`
  returns `[]` for a collapsed path, and
  `renderEdgePanel` skips the section entirely for one.
- `edgePanelActions` now returns the query action
  unconditionally and adds `onGoToSource` only when the
  edge has a single source line. Returning `{}` early,
  as it used to, would have dropped both.
- `bindClassPair` and `PAIR_PLACEHOLDERS` are in
  `app/src/query/resultModel.js` beside `bindSelection`.
  The placeholders are `d3f:SourceClass` /
  `d3f:TargetClass` — prefixed names, so the file is
  valid SPARQL unsubstituted and simply matches nothing.
- The pair is substituted, not bound with `VALUES`:
  this is the one place the `?this` mechanism of
  [ADR 0021](0021-sparql-query-pane.md) cannot be
  reused.
- `scope: pair` is a new value of the `.rq` metadata
  key. `parseQueryDoc` needs no change for it, but the
  library `<select>` handler in `main.js` special-cases
  it to say where the real pair comes from, since an
  empty result reads as "no findings" (ADR 0020).
- The query reads the materialized triples rather than
  re-walking the restrictions, which
  [ADR 0020](0020-sparql-query-engine.md) already
  decided; it is five lines shorter for it.
- `test/alternative-links-query.test.js` gunzips
  `app/public/kg/d3fend.ttl.gz` and skips when it is
  absent, the arrangement `legal-kg-live.test.js` uses.
  It is the parity test.
- Two engine quirks the query is shaped around, both
  found the hard way. A variable inside
  `rdfs:subClassOf*` makes oxigraph plan badly enough
  to hang: the query that answers instantly with the
  classes written in ran over two minutes without
  finishing through a trailing `VALUES`. And
  `BIND(IF(EXISTS {...}))` does not correlate the outer
  `?filler` here — it labelled every row exact,
  including `d3f:contains d3f:ProcessImage` for a
  `d3f:File` target. The tier must come from a `UNION`.
