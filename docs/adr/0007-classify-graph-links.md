# 7. Classify graph links

Date: 2026-07-09

## Status

Accepted

## Context

An IT network graph where nodes are linked by
d3fend relationships can be hard to read,
since links may represent different kinds of relationships:

- data flow: A d3f:reads B, A d3f:writes B, A d3f:executes B, etc.
- control flow: A d3f:runs B, etc.
- network topology (i.e., x shares a direct physical or logical link
  with object y such that communication is *possible*
  between them without intermediate routing): A d3f:connected-to B, etc.
- tactical-verb: A d3f:hardens B, A d3f:detects B, etc.
- other: A d3f:has-location B, etc.

Note: d3f:connected-to is a direct subproperty of d3f:associated-with, sibling of both d3f:accesses (the data-flow root) and d3f:controls, so it is neither flow. It is a third kind of relationship that is neither data nor control flow.

## Decision

- [x] The filtered graph view will classify links by their kind:
  - data flow (d3f:accesses, d3f:executes, d3f:reads, d3f:writes, etc.)
  - control flow (d3f:authenticates, d3f:authorizes, d3f:controls, d3f:runs, etc.)
  - connectivity (d3f:connected-to): a link exists; nothing is asserted to cross it
  - d3f:d3fend-tactical-verb-property (ex. d3f:hardens, d3f:detects, ...)
  - other (all other relationships)
- [x] The UI shows a legend for the link classification, so user can toggle the visibility of each kind of link.
- [x] Only tactical-verb links are styled by kind: they
  are drawn green, arrowhead included, so a defensive
  action is told apart from the flows and the topology
  even with edge labels turned off. The other kinds
  share the neutral grey — five coloured buckets are
  more than a reader can hold in their head, and the
  legend already names them.
- [x] Data flow and control flow take precedence over
  the tactical-verb bucket for the predicates that are
  both, `d3f:authenticates` among them.
- [x] The connectivity bucket holds `d3f:connected-to`
  alone. `d3f:connects` is not a networking predicate
  despite its name — "x joins system y by means of
  communication equipment", used in the ontology only
  by `d3f:T1200` (Hardware Additions) and
  `d3f:ConnectSocket` — so diagrams model network
  links with `d3f:connected-to` and `d3f:connects`
  stays in `other`.
- [x] `d3f:connected-to` declares no `owl:inverseOf`
  and is semantically symmetric, so it is its own
  inverse in the project's inverse map, as
  `d3f:related` already was. It replaced an entry that
  named `d3f:connects` → `d3f:connected-by`, a
  predicate that does not exist in D3FEND.
- [x] A kind added later defaults to visible without
  discarding the de-selections a user has already
  made. The persisted view state therefore records the
  vocabulary in force when it was written, since the
  absence of a kind cannot otherwise be told from the
  user having hidden it.

## Consequences

Pros:

- Visualize data flows and control flows, separating them from other relationships.
- Network topology reads on its own: `connectivity` shows which links exist,
  independently of the flows that use them.
- Extending the vocabulary is not a breaking change
  for users who have saved a filter selection.

Cons:

- Still lacking hierarchical viz.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- Classification is `classifyPredicate` / `LINK_KINDS`
  in `app/src/rdf/linkKind.js`, wired into edge
  metadata in `app/src/rdf/graphModel.js`, filtered in
  `app/src/viz/toCytoscape.js`, and toggled from the
  legend in `app/src/viz/filterPanel.js`.
- The green is the `edge[kind="tactical-verb"]` rule in
  `app/src/viz/graphStyle.js`, keyed on the `kind` that
  `toCytoscape.js` already puts on every edge. It reuses
  the Plan branch colour, so the edge reads as belonging
  with the countermeasure it comes from.
- The self-inverse entry for `d3f:connected-to` is in
  `app/src/rdf/inverse-map.json`.
- Vocabulary migration: `saveFilterState` records
  `kinds` beside `visibleKinds`, and
  `loadFilterState` makes visible any `LINK_KINDS`
  entry that recorded vocabulary did not contain.
  Payloads predating the `kinds` field fall back to
  their own `visibleKinds`, which for them is
  equivalent.
- Both live in `localStorage`, like the rest of the
  view state.
