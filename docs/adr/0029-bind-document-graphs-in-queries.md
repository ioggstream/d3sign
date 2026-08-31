# 29. Bind the document graph set in queries

Date: 2026-08-31

## Status

Accepted

## Context

Queries want document graphs, not knowledge bases
([ADR 20](0020-sparql-query-engine.md)). Each matched
an unbound graph variable and filtered the graph name
after. No index serves a filter, so the engine scanned
every graph first. The filter also guards correctness:
the ontology types its own individuals with the same
classes diagrams use.

## Decision

- [x] Bind the document graph set before using it.
- [x] Enumerate named graphs, excluding the
  knowledge-base namespace. Never hard-code the set.
- [x] Plain SPARQL in the query text; no rewriting by
  the engine.
- [x] Keep each binding in its variable's scope.
- [x] Bind closed predicate sets; leave open-ended
  ones as filters.

## Consequences

Pros: cost is flat in knowledge bases loaded; the
pattern is visible to copy.

Cons: boilerplate per graph variable; no help for
hand-written queries; uneven gains.

## DONTREADME

17 sites in 13 `app/src/data/queries/*.rq`: each
`FILTER(!STRSTARTS(STR(?g), STR(K:)))` became a
preceding `{ SELECT DISTINCT ?g WHERE { GRAPH ?g {}
FILTER(...) } }`. Variables `?g` (12), `?dg` (2),
`?tg`, `?ag`, `?mg`; `00` and `04` need it inside
`FILTER NOT EXISTS`; `07` has none. `FROM NAMED` is
unusable: `declaresDataset()` in
`app/src/query/queryEngine.js` then drops
`use_default_graph_as_union`. `04` also swapped
`FILTER(?verb IN (...))` for `VALUES ?verb`.
`app/test/legal-queries.test.js` runs `08`-`13`
verbatim; `00`-`06` are uncovered.
