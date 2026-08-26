# 28. A diagram may be written in DPV, not only D3FEND

Date: 2026-08-13

## Status

Accepted

## Context

[ADR 0025](0025-legal-knowledge-bases.md) gave the app a legal
tier: W3C's Data Privacy Vocabulary 2.3 with its EU
extensions as a queryable knowledge base, a hand-authored
obligation catalogue and D3FEND alignment, and a vocabulary
registry that made every one of their terms completable and
hoverable in the editor.

What it did not do is let a diagram **author** say anything
in DPV. The class-token regex in
[nodeParser.js](../../app/src/parser/nodeParser.js) matched
`d3f:` and nothing else, so `dpv:PersonalData` typed into a
node was hoverable, explained by a card, and then stripped
into the free-text label. The vocabulary was readable and
unwritable.

The question this closes is *whose personal data does this
system hold, on what basis, and which of the controls drawn
beside it discharge a statutory duty* — a question about the
same boxes the D3FEND diagram already draws, which is why the
answer is more annotations on those boxes rather than a
second diagram.

D3FEND cannot answer it alone. It has no notion of a data
subject, a controller, a legal basis or a purpose, and it
never will: it is a countermeasure ontology. DPV has all
four, shares no IRI with `d3f:`, and is already in the
building.

## Decision

- [x] **Four prefixes are writable, and the set is
  narrower than the set the editor hovers.** `d3f:`, `dpv:`,
  `pd:` and `eu-gdpr:` may type a node and label an edge
  (`TYPING_PREFIXES` in
  [emit.js](../../app/src/rdf/emit.js)). `risk:`, `tech:`,
  `eu-nis2:`, `eu-aiact:`, `ob:` and `al:` may not. The line
  is between vocabularies that describe things *in* a system
  and vocabularies that record a judgement *about* one: a
  risk rating or a statutory duty is something the alignment
  asserts, not something an author draws a box for.

  This is not a stylistic preference. Every writable prefix
  is consumed *anywhere* in a node's text, so admitting
  `risk:` would silently delete the label from
  `A[Cache risk:high]`. The narrow set is what makes the
  wide hover set safe.

- [x] **The official upstream prefix labels, so
  `gdpr:` becomes `eu-gdpr:`.** `legal.ttl.gz` declares
  `eu-gdpr:`, `eu-nis2:` and `eu-aiact:`, and a term
  copy-pasted out of the DPV documentation has to resolve
  without translation — the failure was silent, since an
  unknown prefix is not a term and simply falls through to
  the label. `-` is legal in a Turtle and SPARQL
  `PN_PREFIX`, which is how DPV can use it.

  The two spellings may not coexist. The hover pattern
  anchors a prefix on a non-word character and `-` is one,
  so with both registered `eu-gdpr:X` matches twice — once
  whole, once as a phantom `gdpr:X`. For the same reason the
  prefix alternation is sorted longest-first in both
  patterns.

- [x] **A node carrying both a D3FEND and a DPV class gets
  both `rdf:type` triples.** They are complementary
  statements about one resource, and the whole point is that
  the architecture and the privacy facts annotate the same
  boxes.

- [x] **A DPV-only subgraph is a container, not padding.**
  ADR 0028 as first drafted said the opposite — that a
  subgraph typed only in DPV should behave like an untagged
  one. That is silent data loss: `isTagged`
  ([emit.js](../../app/src/rdf/emit.js)) decides whether an
  id is a resource or presentational padding, and padding
  emits *nothing* and has its children reparented upward. An
  author would have typed a class the editor autocompleted
  and hovered, and watched the graph discard it.

  It also contradicted the previous decision — a DPV-only
  *node* became a resource while a DPV-only *subgraph* did
  not — and revived the cross-block containment bug that
  untagged subgraphs already have.

  Nothing was written for this. `isTagged` only ever asked
  whether `classes` was non-empty; it was the *parser* that
  produced `d3f:` classes and nothing else. Getting the worse
  behaviour would have meant adding a prefix check.

- [x] **DPV properties are in scope, as a `privacy` link
  kind.** The interesting privacy questions are relational —
  who the data is about, who receives it, on what basis —
  so restricting this to node types would have made the
  feature answer none of them.

  `dpv:hasPersonalData`, `hasDataSubject`,
  `hasDataController`, `hasDataProcessor`, `hasRecipient`,
  `hasLegalBasis` and `hasPurpose` are a sixth entry in
  `LINK_KINDS`
  ([linkKind.js](../../app/src/rdf/linkKind.js)), so the
  Links filter can isolate them. They are deliberately
  **not** data flow: they assert what a node is associated
  with, never that anything traverses the link, so they must
  not feed the artifact-path collapse of
  [ADR 0026](0026-collapse-artifact-mediated-paths.md).

  A test pins every entry to a real DPV property, the same
  guard [artifact-flow.js](../../app/src/rdf/artifactFlow.js)
  carries. It has already earned itself:
  `dpv:hasPersonalDataCategory` reads as though it must
  exist, and does not. A category of personal data is a
  *subclass* of `dpv:PersonalData`, so a `pd:` term is a type
  on a node, not a predicate on an edge.

- [x] **An edge label needs a prefix; a bare one is dropped
  with a warning.** The emitter qualified anything not
  starting with `d3f:`, which would have turned
  `|dpv:hasDataSubject|` into `d3f:dpv:hasDataSubject`, an
  IRI in no vocabulary. The obvious fix was to keep a
  writable prefix and go on implying `d3f:` elsewhere. That
  is wrong for a reason worth recording: nothing can
  distinguish a shorthand for a real property from prose
  someone wrote between the pipes, so the rule that made
  `|reads|` convenient also silently minted `d3f:a` and
  `d3f:subClassOf` from
  [mta.md](../../app/src/data/examples/mta.md) — predicates in
  no vocabulary, indistinguishable downstream from real ones.
  `|risk:foo|` is dropped for the same reason rather than
  rewritten onto a `d3f:` IRI.

  The endpoints of a dropped edge are still declared: they
  were mentioned, and mermaid places a node where it is first
  mentioned. Only the relation goes. This is what the README
  had claimed all along ("Untagged link labels are ignored")
  while `testcases.md` asserted the opposite — the
  `edge-forms` case documented the expansion, so the
  behaviour was deliberate, tested, and contradicted by its
  own documentation.

- [x] **The writer's prefix set is narrowed to what a
  document uses, rather than the document set being kept
  small.** ADR 0025 refused to put `ob:`/`al:` in `PREFIXES`
  because n3's `Writer` emits every entry it is handed, so
  the TriG pane's header and 14 snapshots would gain
  prefixes no diagram writes. `expandCurie` reads that same
  map, so DPV could not be admitted without paying it.

  `toTurtle`
  ([serialize.js](../../app/src/rdf/serialize.js)) now filters
  the map to namespaces some IRI in the batch actually lives
  in, which dissolves the objection instead of paying it —
  and lets `ob:` and `al:` in too, so a CONSTRUCT result
  added as a drawn graph serialises readably rather than in
  full IRIs, the wart ADR 0025 recorded as accepted.

  The five prefixes that were always declared stay
  unconditional (`ALWAYS_DECLARED`). Narrowing them as well
  would drop `E:` from every document that has no enrichment
  graph — the churn ADR 0025 refused, arriving by the back
  door. The first attempt did exactly that and moved 14
  snapshots.

- [x] **A DPV family maps onto the categories the view
  already draws, and two of them fold onto D3FEND's.**
  `build-legal-metadata.py` emits a second projection,
  `legal-categories.json`, mapping a qname to one of six DPV
  branches by walking the `parents` chain it already
  computes. `coreCategoryOf`
  ([graphModel.js](../../app/src/rdf/graphModel.js)) reads it
  when no `d3f:` class decides the matter.

  DPV's Entity and Data take D3FEND's `Agent` and `Artifact`
  colour and bucket rather than a second orange and a second
  blue: they are the same concepts in another vocabulary,
  which is exactly what the alignment asserts. So a data
  controller filters as an actor and personal data as an
  artifact. Only Measure, LegalBasis, Purpose and Process get
  new colours, and they share one new `legal` bucket — the
  Nodes filter is a row of checkboxes and four more would
  cost more than they tell anyone.

  This keeps the invariant
  [nodeKind.js](../../app/src/rdf/nodeKind.js) is built on:
  a node's bucket agrees with its colour, because one
  function decides both.

- [x] **`shortLabel` is built from `PREFIXES` instead of
  testing three prefixes by hand.** It tested `rdf:`,
  `rdfs:` and `d3f:`, so a `dpv:`-typed node's `rdfType` came
  out as the whole `https://w3id.org/dpv#PersonalData` —
  printed as a line of the node's label in the drawing, and
  handed to `resolveIconName` as though it were an icon name.
  `curieWith` already existed for this.

- [x] **DPV's personal-data module ships.** `legal.ttl.gz`
  referenced five `pd:` terms and defined none, so
  `pd:MedicalHealth` resolved to nothing and the most useful
  thing a GDPR diagram says — *this store holds health data*
  — was unsayable. One line in `MODULES`.

- [x] **The alignment reaches the node panel through a
  precomputed projection, and only reads.**
  `build-alignment-metadata.py` → `alignment.json`, indexed
  both ways so a DPV-only node can reach the D3FEND classes
  the alignment ties it to. The panel renders on a
  double-click, synchronously, while `K:regulation` is
  fetched into the query worker only once the user ticks it
  in the Sources chip — a panel whose contents depended on a
  checkbox in another pane would be a worse surprise than no
  panel. The same reasoning as every other projection in
  `src/data/` ([ADR 0020](0020-sparql-query-engine.md)), and
  cheap here because `regulation.ttl` is a few hundred
  committed plain lines: no download, no gzip.

  Every row carries its `al:review-status` as a warning
  badge and the section carries a caption, because ADR 0025's
  own conclusion is that coverage is a property of a drawing
  and not a compliance finding. Materialising obligations
  *into* the drawing stays the user-driven CONSTRUCT in
  `13-enrich-legal-obligations.rq`, so a duty never appears
  both as panel text and as a drawn node.

- [x] **One script rebuilds every data file.**
  [rebuild-data.sh](../../app/scripts/rebuild-data.sh), offline
  by default, with `--fetch-dpv [ref]` for the one step that
  downloads. Six generators with six different invocations
  had become four command blocks in the README that had to be
  transcribed in the right order. Two of them could not read
  the only D3FEND file the repo commits — `build-d3fend-`
  `categories.py` and `-completions.py` called `g.parse` with
  no gzip handling — so they got the helper
  `build-d3fend-metadata.py` already had.

## Consequences

- **What was already true needed no code.** The first
  decision of the original draft — that the editor should
  complete and hover DPV terms — was built by ADR 0025.
  `legal-completions.json` ships empty and
  [vocabularies.js](../../app/src/editor/vocabularies.js)
  skips a vocabulary with no terms, so the feature was
  present and inert. Running the projection is what turned it
  on: 2 300 terms across eight prefixes.

- **The original draft's factual claim was wrong.** It
  motivated the extension with `eu-gdpr:DataSubject`,
  `eu-gdpr:PersonalData` and `eu-gdpr:Representative`. All
  three exist in *core* DPV; the eu-gdpr module only refines
  them with Article 4 wording
  (`eu-gdpr:PersonalData rdfs:subClassOf dpv:PersonalData`).
  The extension earns its place through the Article 6 legal
  bases — `eu-gdpr:A6-1-a` and friends — which core DPV does
  not have.

- **Four separate places had to learn that a type can be
  non-`d3f:`**, and each was a silent degradation rather than
  an error: `shortLabel` printed a URL, `coreCategoryOf`
  returned null, `nodeKind` said `other`, and the node
  panel's `d3fClassLocalNames` filtered the definition away
  so a DPV-only node showed a bare RDF table. Anything else
  reading `PREFIXES.d3f` directly is suspect for the same
  reason.

- **The colour palette is now eight entries and no longer
  purely D3FEND's.** `CATEGORY_COLORS` was a projection of
  D3FENDCore; it is now a projection of two ontologies with a
  documented fold between them. A third vocabulary would want
  the same treatment, and at that point the fold table
  belongs in data rather than in a literal.

- **DPV version drift now reaches the drawing, not just the
  queries.** ADR 0025 noted that a rename in 2.4 turns an
  `al:legal-concept` into a triple that joins with nothing.
  It now also turns a diagram's `rdf:type` into a term with
  no definition and no family, so the node loses its colour
  and its panel text. It still does not error.
  `legal-kg-live.test.js` remains the only guard.

- **`al:` and `ob:` are in `PREFIXES` after all**, which
  supersedes the last consequence of ADR 0025. The reason
  given there was real; the fix was to narrow the writer, not
  to keep the map small.

- **The alignment covers 15 mappings over 15 D3FEND
  classes.** The Legal section is therefore empty on almost
  every node, and no attempt is made to hide that: borrowing
  a D3FEND icon for a DPV node through the same 15 mappings
  was considered and dropped, because an icon strategy with
  1% coverage is worse than an honest coloured dot. The
  family palette covers all 758 projected terms instead.

- **`legal-categories.json` and `alignment.json` are two
  more generated files under `src/data/`**, bringing it to
  six. They are committed, like `legal.ttl.gz` and for the
  same reason — the app must work on a fresh clone — and
  `rebuild-data.sh` exists because six was the point at which
  the rebuild stopped being memorable.

- **Dropping the implied `d3f:` is a breaking change to
  documents in the wild.** A diagram written with bare
  labels loses those edges and gains a warning per line. That
  is the intended outcome — the alternative is that some of
  those edges were always predicates that do not exist — but
  it is not a silent migration, and `mta.md` is the example
  in the repo that changes.

- **`pd:` terms are types, and there is no predicate for
  them.** A reader looking for `dpv:hasPersonalDataCategory`
  will not find one; the category goes on the node. This is
  DPV's design, not a limitation here, and the example says
  so because the wrong guess is the natural one.
