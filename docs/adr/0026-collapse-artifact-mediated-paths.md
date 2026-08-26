# 26. Collapse artifact-mediated paths into message links

Date: 2026-08-12

## Status

Accepted

## Context

A diagram that reifies its messages writes each exchange
as two links through a middle node:

```
client -->|d3f:produces| requests -->|d3f:executed-by| api
api    -.->|d3f:produces| responses -.->|d3f:accessed-by| client
```

That is the right RDF. The message is a resource, it
carries a `d3f:` class, and both halves of the hop are
real assertions. It is a poor *drawing*: the graph pane
shows a bipartite graph in which no two agents are ever
adjacent, so the thing the diagram is about — who
exchanges what with whom — has to be reassembled by eye,
two hops at a time. `003-webapp.md`, `004-data-pipeline.md`,
`db-replica.md`, `ssh-authentication.md` and
`ci-artifact-generation.md` are all written this way.

Two things the source says already do not reach the view,
and neither is available to fix this. The dotted/solid
arrow style is dropped at the emitter
([ADR 0014](0014-graph-view-from-rdf-only.md)), and in
the graph pane dashed already means "derived from a
fold". And nothing anywhere carries an order: `arrowIndex`
is excluded from the RDF path by name, edges are bare
triples, and `model.edges` order is `store.getQuads()`
order.

## Decision

- [x] **An artifact whose whole presence in the drawn
  graph is one producing link in and one consuming link
  out is not drawn.** The path through it becomes a single
  arrow between the two parties, labelled with the
  artifact's own label — payload-first, because that is
  the fact the collapse removes from the drawing, and
  because it makes the arrow read as a message rather than
  as a composition of two predicates.

- [x] **A view transform on the element set, not a
  layout.** It lives in
  [viz/toCytoscape.js](../../app/src/viz/toCytoscape.js);
  [viz/layouts.js](../../app/src/viz/layouts.js) stays
  pure geometry, deciding *where* elements go and never
  *which* exist. The store is never touched, so the TriG
  pane is byte-identical collapsed or not — the same rule
  container folding follows
  ([ADR 0012](0012-fold-container-nodes.md)).

- [x] **A View preference** (`collapseArtifactPaths`,
  `Alt+V`, [ADR 0015](0015-graph-visualization-preferences.md)),
  **defaulting off.** Every other preference in that chip
  changes how the drawing looks; this one changes what is
  in it, and a diagram has to be seen as the TriG
  describes it before it can be simplified. It is
  therefore also the first preference whose change needs a
  rebuild rather than a restyle.

- [x] **The candidate test is structural, not taxonomic.**
  `coreCategory === 'Artifact'` is unusable in both
  directions: `d3f:Process`, `d3f:WebServerApplication`
  and `d3f:DatabaseServer` are all Artifacts, while
  `d3f:EventLog` resolves to the `Log` branch and gets no
  core category at all. And there is no subtree to appeal
  to instead — D3FEND has no data-versus-processing axis,
  whose least common ancestor is
  `d3f:DigitalInformationBearer` and therefore also
  contains processes, threads and hosts. So a node
  qualifies by what it *does*: one producing leg, one
  consuming leg, and nothing else. Any other incident
  edge, a self-loop, or children of its own refuse the
  collapse and the node is drawn. Nothing is hidden by
  removing a node that asserts nothing else.

- [x] **One taxonomy check survives, as a veto:** a node
  resolving to the `Agent`, `Plan` or `Goal` branch is
  never a message, however its links read. Free, since
  `nodeKind` is already on the model node, and correct
  by construction because `coreCategoryOf` ranks `Agent`
  above `Artifact`.

- [x] **A payload inside a container is collapsed; a
  payload with children is not.** Refusing all containment
  would have been safer and would have missed the three
  most compelling diagrams in the repo — `db-replica.md`,
  `ssh-authentication.md` and `ci-artifact-generation.md`
  all put their artifacts inside a subgraph. The one fact
  lost is which container the payload lived in, and the
  edge panel is where that is said. A container the
  collapse empties stops being drawn as a container, or it
  would be a label band around nothing.

- [x] **Roles are classified on the predicate as
  written**, in
  [rdf/artifactFlow.js](../../app/src/rdf/artifactFlow.js),
  and travel on the model's edges. Two things follow that
  are worth having: `toCytoscape.js` keeps its zero
  imports from the RDF layer, which ADR 0014 requires; and
  the per-predicate direction swap
  ([ADR 0019](0019-select-and-swap-edges.md)) cannot change
  which paths collapse, because the model is built before
  any direction state exists.

- [x] **A role is a predicate *and* an end**, not a
  predicate alone. The consuming leg is not reliably the
  `-by` form: `d1 -->|d3f:accessed-by| p1` puts the
  consumer on the object end, `api -->|d3f:executes| request` puts it on the subject end, and both are in the
  examples.

- [x] **Only predicates that exist in D3FEND are
  composable.** `d3f:read-by`, `d3f:written-by`,
  `d3f:decoded-by` and `d3f:transferred-by` are display
  labels the edge swap invents rather than properties, and
  are correctly absent from `DATA_FLOW_PREDICATES`. Every
  composable predicate *is* in that set, which is what
  makes the collapse independent of the `other` link kind
  being visible, and what makes the collapsed arrow's
  hardcoded `data-flow` kind honest. Both are asserted by
  a test.

- [x] **The pass runs after the Nodes and Links filters,
  and is gated on the data-flow kind.** So every filter
  stays authoritative: hiding either leg leaves the path
  incomplete and the payload is drawn with its surviving
  link, rather than a derived arrow quietly undoing the
  filter. It runs *before* the fold re-anchoring, so the
  synthetic arrow anchors onto a folded container like any
  other edge, and disappears when both its ends fold into
  the same one.

- [x] **Request and response stay two arrows.** Two
  payloads are two synthetic predicates, so ADR 0024's
  same-predicate rule for a two-way link does not fire —
  which matters, because drawing them as one
  double-headed arrow would destroy exactly the reading
  this change exists to produce.

- [x] **`standsFor` carries the provenance**, not
  `foldedFrom`/`foldedTo`: those are two endpoint *sets*
  read against **one** predicate, and a collapsed path is
  two triples with two different predicates. So the edge
  panel lists both real triples with their own predicate
  names, and `g` walks to both mermaid arrows in turn.

- [x] **Fan-out and fan-in collapse; fan-out *and* fan-in
  does not.** One producer to `M` consumers draws `M`
  arrows and still removes the payload, and likewise for
  `N` producers to one consumer. `N` and `M` both above
  one is refused, because `N*M` derived arrows in place of
  `N+M` written ones is not a simplification —
  `N*M ≤ N+M` exactly when one side is single. A payload
  whose producer and consumer are the same party is
  refused for a different reason: a scratch file written
  and read back by one process is not a message, and a
  self-loop would say less than the two links do.

- [x] **The arrow is dotted where a fold's is dashed.**
  Both are non-triples; they are not the same non-triple.
  Colour and arrowhead are left alone, for the fold's
  reason: the direction it draws is the direction the data
  moves, and its kind is literally true of it.

## Consequences

Pros:

- The exchange is legible: four arrows between three
  parties instead of eight links through four artifact
  nodes, with the payload named on each.
- Nothing is lost. The TriG is unchanged, the edge panel
  names both triples, `g` reaches both source lines, and
  the chips count what is on screen.
- No new mermaid syntax, no new predicate, no emitter
  change, so `testcases.md` and every `.trig` snapshot are
  untouched.
- The structural rule needs no new precomputed table and
  matches `d3f:WebResourceAccess`, `d3f:DatabaseQuery`,
  `d3f:DatabaseRecord`, `d3f:EventLog` and `d3f:File`
  without naming any of them — including untyped nodes.

Cons:

- **It does not deliver ordering, which is what a reader
  usually wants next.** `client → api` and `api → client`
  are still an antiparallel pair with nothing saying which
  came first, so the graph stays cyclic and `elk-layered`
  still cannot lay it out as a sequence. A step-1/step-2
  reading needs an ordinal in the RDF, which nothing here
  provides.
- Toggling it costs one redundant layout: `setPrefs`
  restyles and fits, then the rebuild re-runs the layout.
  The alternative was `graphPane` caching the model and
  the filter state and returning stats from `setPrefs`,
  i.e. a wider contract for the pane.
- A collapsed arrow has no written predicate, so three
  things need explicit suppression rather than falling out:
  it is never flipped, `s` says something different on it,
  and the panel must not report it as drawn-inverted.
- Two payloads with the same label between the same pair
  of parties merge into one `×2` arrow. Consistent with
  folding, still a small loss.
- The refusal rules are invisible: a payload that stays
  drawn does not say why. The reasons are all
  discoverable by looking at its other links, but nothing
  points at them.

## DONTREADME

Notes for LLM agents. They describe the code as it is,
not the decision, and go stale: check the code before
trusting them.

- The pass is `collapseArtifactPaths` in
  [toCytoscape.js](../../app/src/viz/toCytoscape.js),
  called as step 3½ between the edge filter and the
  re-anchoring, plus `payloadEndOf`/`partyEndOf` above it.
  It returns `{ edges, payloads }`.
- `toCytoscapeElements` gained a third argument,
  `viewOptions`, defaulted to `{}` — which is why no
  existing test needed changing.
- Four edits inside the existing steps: `predicateLabel`
  and the new `groupToken` (3a), `derived` forced true for
  a collapsed edge, `reciprocalId` built from the token,
  and the `standsFor`-versus-`foldedFrom` branch in the
  derived element. The `derived` one is the load-bearing
  bug to avoid: without it the element falls into the
  *asserted* branch and loses all its provenance.
- `hasDrawnChild` is the collapse-aware sibling of
  `hasVisibleChild`. Only step 4 uses it; `foldRoots`
  keeps the plain one, which is what makes the ordering
  acyclic — a fold root can never have a collapsed child,
  since a payload under a folded ancestor is refused.
- The synthetic predicate is `collapsed:<payload iri>`.
  Not a real CURIE (would claim an assertion) and not null
  (`reselectEdge` in `graphPane.js` matches on
  `predicate` plus the unordered endpoints, so null would
  make every collapsed arrow between one pair
  interchangeable).
- Readers of `data.collapsed`: `graphStyle.js`
  (`edge[collapsed]`), `edgePanel.js`
  (`edgePanelSummary` returns early, before the fold's
  cross product), `goToSource.js` (`writtenTriplesOf`
  branches first), and `main.js`'s `s` handler.
- `renderEdgePanel` now reads `pair.predicate ?? summary.drawn`, so one row renderer serves both the
  fold and the collapse.
- `d3f:may-be-produced-by` and `d3f:may-be-executed-by`
  are in `DATA_FLOW_PREDICATES` but are not D3FEND
  properties; they are deliberately not in the role
  tables. Noted in `ISSUES.md`.
- Tests: `app/test/artifact-flow.test.js` (new, including
  the two invariants that keep the hardcoded `data-flow`
  honest) and the
  `toCytoscapeElements — collapsing artifact-mediated paths` block in `app/test/graph-model.test.js`. The
  `filterState` helper there gained a `kinds` option.
