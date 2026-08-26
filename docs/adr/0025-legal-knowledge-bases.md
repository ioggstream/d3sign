# 25. Legal knowledge bases, and the alignment that joins them to D3FEND

Date: 2026-08-10

## Status

Accepted

## Context

[ADR 0020](0020-sparql-query-engine.md) promised that
adding a knowledge base would be a turtle file, a
manifest entry and some `.rq` files — three steps and
no code change. Nothing had tested that: `d3fend` was
the only entry.

The question to answer is legal rather than technical:
*which NIS2 or GDPR duty does this control discharge,
and which duties has nothing been drawn for*. Three
things were missing. A legal vocabulary. A catalogue of
obligations at the granularity a control can address.
And a join, because a legal vocabulary shares no IRIs
with `d3f:` and never will.

W3C's Data Privacy Vocabulary supplies the first: DPV
2.3 plus its EU extensions for GDPR, NIS2 and the AI
Act, published as turtle under CC-BY-4.0. It does not
supply the second — DPV's `eu-nis2` module is 282
triples about incident notices and compliance status,
with no catalogue of the Article 21(2) measures at all.
So the obligations are transcribed by hand, and so is
the join.

## Decision

- [x] **Two named graphs, split on
  generated-versus-hand-authored and nothing else.**
  `K:legal` is `legal.ttl.gz`, built from DPV by
  [build-legal-kg.py](../../app/scripts/build-legal-kg.py).
  `K:regulation` is
  [regulation.ttl](../../app/public/kg/regulation.ttl),
  plain, committed and hand-edited: the obligation
  catalogue and the D3FEND mappings, as separate
  subjects under two commented sections in one file.
  Hand-authored content cannot live inside the build
  artifact, because a rebuild would overwrite it and a
  gzipped blob is unreviewable. Everything else that
  looked like a reason to split — obligations versus
  mappings, one module versus another — is a
  distinction between *subjects*, which SPARQL already
  makes, so it buys nothing and costs a checkbox.

- [x] **A hierarchy never crosses a named graph.** A
  property path is evaluated inside one `GRAPH`
  binding, so `skos:broader+` over a vocabulary split
  across two graphs stops at the boundary and returns a
  shorter, plausible-looking answer rather than an
  error. All nine DPV modules therefore ship in one
  graph — the EU ones hang almost everything off `dpv:`
  and `risk:` terms. Links *between* graphs are one hop
  only: `al:d3fend-class`, `al:legal-concept`,
  `skos:relatedMatch`. There is a test that fails if
  someone splits the vocabulary
  ([legal-queries.test.js](../../app/test/legal-queries.test.js)).

- [x] **DPV is concatenated verbatim, not pruned.**
  Turtle allows a prefix to be redeclared mid-document,
  no module uses `@base` or a relative IRI, and no
  prefix label is bound to two different IRIs across
  them — so `cat` produces valid Turtle. It is
  byte-stable for free, since the bytes are upstream's
  bytes, which keeps a rebuild from adding a fresh
  200 KB blob to git history. A pruning pass was
  written and measured first, and was worse on both
  counts that mattered: 255 KB against 165 KB (sorted
  N-Triples compress worse than upstream's grouped
  Turtle), and it deleted every `dct:creator` /
  `dct:contributor` / `dct:license` triple, i.e. DPV's
  CC-BY attribution. Blank nodes are left alone;
  concatenation merges the same-labelled contributor
  nodes across modules, which is harmless
  deduplication.

- [x] **Legal prefixes go in the query preamble
  unconditionally**, in
  [queryPrefixes.js](../../app/src/query/queryPrefixes.js),
  not on the manifest entries. `queryPrefixes()` merges
  a base's own `prefixes` only once it is *loaded*, so a
  query naming `K:regulation` but writing `dpv:` would
  parse or fail depending on which checkboxes happened
  to be ticked. The field stays as an extension point
  for a base whose vocabulary is genuinely private to
  it; nothing uses it. `preambleLineCount` already
  feeds `adjustErrorPosition`, so a longer preamble
  needed no other change.

- [x] **The alignment defines its own predicates**
  rather than reusing `skos:relatedMatch` /
  `closeMatch` as the join. They cannot carry a
  rationale, a strength or a citation without reifying
  anyway; their symmetry and `exactMatch` transitivity
  would be a lie about an `owl:Class`/`skos:Concept`
  pair; and DPV already uses them internally, so
  overloading them would make our claims
  indistinguishable from upstream's. A one-hop
  `skos:relatedMatch` is emitted alongside as an
  interop courtesy, never `close`- or `exactMatch`.

- [x] **`al:rationale` is mandatory, and every seeded
  mapping is `al:Draft`.** An unexplained claim that a
  control discharges a statutory duty cannot be audited
  or argued with, which makes it worse than no claim.
  `al:strength` is `Full` / `Partial` / `Supporting`
  because "covered" is not a fact about a drawing.

- [x] **A mapping is written against the most general
  D3FEND class whose reasoning holds**, and queries
  resolve `rdfs:subClassOf*`. Mapping `d3f:Credential`
  earns `d3f:Password` for free; mapping `d3f:Password`
  would not work the other way round.

- [x] **Citations are display strings, never join
  keys.** `dct:source` is unnormalised on both sides
  (`"GDPR Art.5-2"` against `"GDPR Article 32(1)(a)"@en`,
  some tagged and some not, some pointing at
  bibliographic blank nodes). Joins are on IRIs. This is
  stated in the file, because matching the strings is
  the obvious optimisation and it returns near-zero rows.

- [x] **Terms of every knowledge base are hoverable and
  completable**, through a vocabulary registry
  ([vocabularies.js](../../app/src/editor/vocabularies.js)).
  A term's identity is now its **qname** —
  `d3f:Password`, `ob:nis2-art21-2-h` — not a bare local
  name, which is only unique inside one vocabulary. The
  hover token pattern and the completion triggers are
  both built from the registry, so the hoverable and the
  completable prefixes are the same set by construction.
  Two incidental fixes fall out: `.` is now in the local
  name charset, so `d3f:AML.T0000` works, and a prefix
  ending another identifier no longer reads as a term.

- [x] **The legal vocabularies get a second precomputed
  JSON**,
  [build-legal-metadata.py](../../app/scripts/build-legal-metadata.py)
  → `legal-completions.json`, in the same item shape as
  `d3fend-completions.json`. For the reason ADR 0020
  already gives: completion and hover run on a keystroke
  and cannot wait for the worker to fetch and parse
  30 000 triples. The article citation is projected too,
  because on a legal term that is the most useful thing a
  card can show — as `sources: [{label, url}]`, a row of
  links under the definition.

  `dct:source` is a *blank node* in most of DPV: a
  `schema:WebPage` holding `schema:name` ("GDPR Art.4-2")
  and `schema:url` (the eur-lex article). The blank node is
  dereferenced at build time, never carried as a node.
  Stringifying it — what the first version did — put
  rdflib's generated id in the card
  (`(n27048014d4c94bef948a8119a70c7565b17)`) and, since
  that id is regenerated on every parse, made a committed
  file whose every rebuild was a fresh 600-line diff. The
  literal (`"DGA 12.k"`) and IRI shapes flatten into the
  same pair, so the card draws one citation shape.

- [x] **`missingHint` moves onto the manifest entry.**
  The worker's error path used to print *"The ontology is
  not committed"* and *"gzip -9 -c /path/to/d3fend.ttl
  …"* for any base — the first false, the second actively
  wrong advice for a base built by a different script.
  This is the one line of plumbing outside the manifest
  that adding a knowledge base turned out to need, and it
  is recorded here rather than left to rot in ADR 0020.

## Consequences

- The promise of ADR 0020 held, with that one
  amendment: two entries, two data files, six `.rq`
  files, no engine or worker change beyond an error
  message.

- **DPV version drift is the real risk.** A rename in
  2.4 turns `al:legal-concept dpv:X` into a triple that
  joins with nothing; query 09 hides it as a blank
  column and query 11 just counts one less. Nothing
  errors.
  [legal-kg-live.test.js](../../app/test/legal-kg-live.test.js)
  is the only guard and is load-bearing, not
  decoration. The same risk against a D3FEND rename is
  guarded by checking every `al:d3fend-class` against
  the completion projection.

- `--ref master` is a mutable target, so two builds a
  week apart can differ while claiming the same
  provenance. The script warns and records the ref in
  the file's header. Prefer a tag.

- Attribution survives only in that header, the
  manifest `description` and the README. It must stay
  there.

- `MATERIALIZE_RESTRICTIONS` runs on every loaded graph
  and is a verified no-op on DPV — zero `owl:Restriction`
  in any module, so the Sources chip reports
  `inferred: 0`. One wasted UPDATE pass per load,
  asserted as a known quantity rather than assumed.

- `al:` and `ob:` are deliberately absent from
  `PREFIXES` in [emit.js](../../app/src/rdf/emit.js).
  Adding them would rewrite the TriG pane's header and
  14 snapshot fixtures for prefixes no diagram uses —
  exactly what ADR 0020 refused for `K:`/`Q:`. So a
  CONSTRUCT result added as a drawn graph serialises
  with full IRIs, and query 13 supplies an `rdfs:label`
  so the drawing is still readable.

- The Sources popover now lists three bases and will
  list five once DORA and an ISO catalogue exist.
  `sourcesPanel.js` has no grouping. That becomes a UI
  change driven by count, not by this design.

- **Coverage is a property of a drawing, not a
  compliance finding.** Everything here answers "does
  the document contain an instance of a class some
  hand-authored mapping associates with this duty". It
  says nothing about whether the control is configured,
  deployed, effective or in scope. Two obligations in
  the seed catalogue — staff training, and the
  pseudonymisation limb of GDPR 32(1)(a) — are
  permanent gaps, because D3FEND has no technique for
  either. That is honest, and it is also the fixture
  the gap query is tested against.
