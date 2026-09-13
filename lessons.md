# Lessons

## 2026-09-01 — a hierarchy walk moved inside the wrong GRAPH block empties a NOT EXISTS

Task: `04-undefended-data-flows.rq` reported every artifact as undefended,
including `G:query`, which `d3f:DatabaseQueryStringAnalysis d3f:analyzes`.

Cause: `?mverb rdfs:subPropertyOf* d3f:d3fend-object-property` had been moved
inside the `GRAPH ?dg { … }` block of the `FILTER NOT EXISTS`. The document
graph holds no `rdfs:subPropertyOf` triple — the hierarchy is in `K:d3fend` —
so the pattern matched nothing, the whole `NOT EXISTS` body went empty, and the
filter passed everything.

Lesson: a `NOT EXISTS` that becomes unsatisfiable fails *silently and
inverted*: instead of losing rows it keeps all of them, and the output still
looks like a finding list. Every hierarchy path belongs in the `GRAPH` block
that actually holds the hierarchy — `K:d3fend`, named explicitly — never in a
document graph and never left to the union default graph, which only works
because `use_default_graph_as_union` happens to be on.

Also: the query file on disk had changed since the first read of it in the
session. Re-read before diagnosing — same lesson as 2026-08-11.

Verification: pyoxigraph, real `d3fend.ttl.gz` loaded into `K:d3fend` with the
engine's restriction materialization, the diagram loaded as TriG. Broken
variant: 4 rows; fixed: 3, `G:query` dropped.

## 2026-08-31 — a FILTER on a graph name is a scan, not a lookup

Task: `GRAPH ?g { ?this a ?class }` followed by
`FILTER(!STRSTARTS(STR(?g), STR(K:)))` was slow in every shipped query.

What worked:

- Naming the real cost. A FILTER cannot be pushed into an index, so an unbound
  `?g` means matching the pattern in every graph, K:d3fend's 130k triples
  included, and discarding almost all of it. `LIMIT` does not rescue it.
- `GRAPH ?g {}` as the enumerator. The empty group matches once per named graph,
  so a subquery binds `?g` from a handful of graph *names* and the block that
  follows is an indexed lookup. Vanilla SPARQL, no engine change.
- Putting the subquery in the scope that owns the variable. Eight of the 17
  sites are inside `FILTER NOT EXISTS` or `OPTIONAL`, where the graph variable
  is local. The trailing `VALUES` trick `bindSelection()` uses for `?this` binds
  only at the top level; hoisting `?dg` out of the `NOT EXISTS` in `00` and `04`
  would silently change "no measure in *any* document graph" into "no measure in
  *this* graph".
- Checking the variable names before designing anything. 12 sites use `?g`, but
  5 use `?dg`, `?tg`, `?ag`, `?mg`. Any scheme keyed on `?g` would have missed
  them.
- Reading the KB before claiming the filter was only about speed. `zcat d3fend.ttl.gz | grep -oE '\ba (d3f:[A-Za-z0-9_-]+)'` shows ~1000 individuals —
  299 `d3f:CCIControl`, 9 `d3f:DocumentFile`. Without the graph restriction the
  ontology's own `d3f:DocumentFile` instances get reported as the user's
  undefended artifacts. That killed the idea of binding `?class` instead.

What did not:

- Proposing an engine-side rewrite first. It covers hand-written queries, but it
  makes the `.rq` say one thing and the engine run another, and the user wanted
  the pattern visible in the query text. Ask which layer before designing for
  one.
- `FROM NAMED`, the idiomatic way to restrict a dataset. `declaresDataset()`
  turns off `use_default_graph_as_union` the moment `FROM` appears, so it would
  have broken every pattern outside a `GRAPH` block — the exact failure the
  2026-08-28 lesson above is about.
- Guessing at ADR length and shape. `0001-use-adr.md` says no code, no file
  names and no implementation detail outside `## DONTREADME`, and Consequences
  as Pros/Cons. Read it before writing, not after two rejections.
- `node` is still not on the host, so nothing here is verified. Six of the 13
  files are covered by `legal-queries.test.js`, which runs the `.rq` verbatim;
  `00`-`06` need the SPARQL pane.

## 2026-08-28 — an empty default graph makes a correct query return nothing

Task: a generic `SELECT * WHERE { ?s ?p ?o }` had to see every graph.

What worked:

- Reading the loader before the query path. Every write goes to a named graph
  (`to_graph_name` for knowledge bases, the graph name inside the N-Quads for
  document quads), so the default graph the engine queries by default is empty
  and always was. The symptom was zero rows; the cause was one missing option.
- `use_default_graph_as_union` on `store.query()`, one flag, no rewriting of the
  user's text. Rewriting a query to add `GRAPH ?g` would have changed what the
  user asked.
- Withholding the flag when the query says `FROM`. Stripping comments, literals
  and IRIs with a *single* alternation regex rather than successive replaces:
  one scan takes whichever construct opens first and consumes it whole, so a
  `#` inside a literal and a quote inside a comment both behave.
- Checking the whole suite before and reasoning about which failures were mine.
  Three tests fail at HEAD (`link-kind`, `graph-visibility`, and a
  `legal-queries` fixture whose turtle slice loses its `rdfs:` prefix
  declaration); none touch the query path.

What did not:

- `node` is not on the host, so nothing could be verified without
  `docker compose exec dev`. Planning assumed oxigraph might reject `FROM`
  combined with the union flag; the tests showed the question never arises,
  because the flag is withheld exactly then.

Rule: when a store keeps everything in named graphs, the default graph is a
design decision, not a default. Say so in the engine, or every query silently
answers "no findings".

## 2026-08-14 — a blank node stringified into the UI

Task: the legal projection must not track blank nodes; dereference them instead.

What worked:

- Reading the *diff* of the generated file first: every changed line was a
  citation id changing (`n2704…b17` → `n46cb…b18`), which named both the bug
  (rdflib's generated blank-node id shown as a citation) and its second symptom
  (a committed file that is a fresh 600-line blob on every rebuild).
- Dumping one offending node's predicates before designing the fix: DPV's
  `dct:source` blank node is a `schema:WebPage` with `schema:name` and
  `schema:url`, so the dereference had somewhere useful to land — a card row
  linking to eur-lex, not just the id removed.

Worth remembering:

- `str()` on an rdflib term is only meaningful for literals and IRIs. A helper
  that stringifies "the first value" (`first()` here) must filter blank nodes,
  or a shape change upstream leaks generated ids into the product.
- Checking every consumer of the field that changed shape: dropping the
  parenthetical citation out of `documentation` silently removed it from
  `nodePanel.js` too, which reads the same projection.

## 2026-08-14 — a one-directional lookup for a symmetric relation

Task: the edge swap did nothing on `d3f:used-by`.

What worked:

- Following the dead feature backwards rather than forwards:
  `nodeMenu` gates the item on `data.invertible`, `toCytoscape` sets it from
  `edge.inverse`, `graphModel` fills that from `inversePredicateOf` — which is a
  plain `inverseMap[predicate]` lookup. `inverse-map.json` listed
  `d3f:uses → d3f:used-by` and nothing the other way, so every diagram writing
  the passive leg (two shipped examples do) drew a non-invertible edge.
- Asking `/d3fend-expert` for the ontology's `owl:inverseOf` and
  `owl:SymmetricProperty` sets instead of extending the map by hand: 44 declared
  pairs against the 4 the file happened to have, and it caught
  `d3f:depends-on → d3f:dependency-of`, an inverse name no vocabulary defines
  while D3FEND declares `d3f:has-dependent`.

Worth remembering:

- Inversion is symmetric, so a table of it should be *read* symmetrically —
  deriving the reverse once in `inversePredicateOf` keeps the file one line per
  pair and makes the whole class of "wrote the passive leg" bugs impossible.
  Adding the missing rows by hand would have fixed `used-by` and left the next
  one waiting.
- A stale test can assert the bug: `node-menu.test.js` expected an empty menu
  for a node with no mermaid source, from when the jump was the only item.

## 2026-08-14 — a font size the editor never re-measures is only half applied

Task: make the CodeMirror font size configurable.

What worked:

- The View ⚙ popover already had the whole mechanism — `PREF_RANGES` +
  `DEFAULT_PREFS` in `graphPrefs.js`, a generic slider loop in `prefsPanel.js`,
  clamping and localStorage for free. The feature was one range, one default,
  one `SLIDERS` row and a CSS variable.
- Sizing through CSS (`--editor-fs` on the root, one `.cm-editor` rule) rather
  than an `EditorView.theme` reconfiguration: three panes, one declaration, and
  the size is applied before any editor is constructed.

Worth remembering:

- CodeMirror caches character metrics. Changing the font size in CSS repaints
  the text but leaves `lineWrapping` and caret placement computed against the
  old metrics until `view.requestMeasure()` runs — the same cache that makes
  `requestMeasure()` necessary after a hidden pane is shown.
- The three editors had silently disagreed: `#turtle-host`/`#query-host` were
  pinned to `--fs-sm`, `#editor-host` had no rule at all and took the 16px
  document default. A "make it configurable" task is a good moment to find out
  that there was no single value to make configurable.

## 2026-08-13 — validate RDF bulk edits with structural checks, not one fragile regex

Task: add EUR-Lex ELI links for every legal source citation in
`app/public/kg/regulation.ttl`.

What worked:

- Use article-level ELI URLs that are stable and canonical in EUR-Lex:
  `.../eli/dir/2022/2555/art_21/oj` and `.../eli/reg/2016/679/art_32/oj`.
- Add `rdfs:seeAlso` immediately after each `dct:source` so the citation text and
  legal link remain co-located in diffs.
- Validate coverage with two independent checks:
  1. count `dct:source` statements, and
  1. assert each source line is immediately followed by a `rdfs:seeAlso` line.

Specific error:

- Shell quoting in complex count/awk commands produced false zero counts and awk
  parse errors. Recovery was to simplify commands and avoid brittle quoting first,
  then verify with a structural adjacency check.

## 2026-08-11 — read the file, don't trust the copy you already have

Two turns of UI analysis were built on a `main.js` that was 740 lines with no
SPARQL pane. The file on disk was 1122 lines and had one. The stale copy came from
my own earlier read, and nothing in it looked wrong — it parsed, it was coherent,
it ended on a plausible line. What caught it was a second measurement disagreeing
with the first: a `wc -l` run for a different reason. The lesson is not "re-read
files" but **cross-check the number you are about to reason from**, because a
stale read fails silently while a contradiction between two measurements does not.

The restyle that followed put a token layer at the top of `app.css` (73 custom
properties) and stated one rule in the header comment: no colour, radius, shadow
or font size may be written as a literal below it. Writing the rule down forced
four literals I had just written to be tokenized — `#fff` on the primary button,
the brand gradient's far stop, the canvas white, the modal scrim. A rule in a
comment that the file below it violates is worse than no rule, because the next
person trusts it.

Two things the restyle fixed by deleting rather than adding: the header's magic
`calc(100vh - 3.5rem)`, replaced by a two-row body grid — the magic number had to
track the header's padding by hand, and a wrapped lint message silently pushed the
columns off the bottom of the screen; and the `margin-bottom: 0.5rem` that six
different header controls each carried to fake baseline alignment, which left the
one control that forgot it (the SPARQL library select) half a step high. Both were
compensation for a container that wasn't doing its job.

## 2026-08-07 — the existing hack was the proof the rework was cheap

Asked whether a VS Code-like layout was worth building, the honest answer came
from one function already in the codebase: `setTurtleFolded` re-parented the live
TriG pane between a column and the tab bar. That single hack proved the hard
part — that a mounted cytoscape instance and a CodeMirror `EditorView` survive
being moved — so the feature was not "build a dock manager", it was "generalise
the thing that already works to every pane".

That also settled the library question. `golden-layout` recreates panel DOM on
drag, which would mean a new `cy` and a lost undo history; `dockview-core` keeps
the element but needs an adapter as large as the whole hand-rolled module. The
deciding constraint was never bundle size, it was *lifecycle*: this app must
mount once and never unmount, which disqualifies any library whose contract is
"give me a render function and I'll call it when the panel appears".

Two bugs fell out of reading the code to answer the question, both invisible
until something else changed. `makeResizableGutter` parsed
`getComputedStyle(...).gridTemplateColumns` — always resolved *pixels* — as `fr`,
surviving only because a drag renormalises the ratio; it broke the moment a
template held literal `0px` tracks. And the graph's `ResizeObserver` called
`cy.fit()` on every tick, so every gutter drag silently discarded the user's pan
and zoom. Both were fixed by construction rather than patched: the model owns the
fractions, and `resize()` (measure) is now separate from `fitView()` (measure and
frame).

The estimate needed recalibrating too. "6 days" was a human-day figure, and most
of it was drag-and-drop — untestable in a node-only suite, tuned by feel, paid
for in the *user's* browser round-trips, not in my output. Splitting the estimate
by who pays is what let the scope decision be made honestly.

## 2026-08-07 — "the direct triples exist" is not the same as "the direct triples are complete"

Planning the SPARQL feature, I checked whether D3FEND expresses
technique→artifact relations as `owl:Restriction` blank nodes and concluded it did
not, because `build-d3fend-metadata.py` reads them with rdflib's
`predicate_objects` — a direct-triple call — and produces a populated
`relations` array. So the canned queries were written against
`?measure d3f:hardens ?artifact`.

The evidence was real and the conclusion was wrong. `d3fend.ttl` asserts *both*
forms, and the direct one is incomplete: 1772 restriction-form relations against
~2612 direct, and the shortfall is not uniform — `d3f:preceded-by` has 115
restrictions and **zero** direct triples, `d3f:has-participant` 144 against 3. The
build script was not evidence of completeness; it was evidence that *enough*
direct triples existed for the questions it happened to ask.

Two things worth keeping. A working consumer proves a shape is *present*, never
that it is the only shape or the complete one — to claim coverage you have to
count both. And the fix belonged at load time, not in the queries: one
`INSERT { ?c ?p ?t } WHERE { ?c rdfs:subClassOf [ owl:onProperty ?p ; owl:someValuesFrom ?t ] }` per knowledge base, rather than a `UNION` that every
canned query *and every query a user writes* would have to know about. The count
goes on the Sources chip, because the failure mode it prevents is an empty result
that reads as "no findings".

Measure before believing the shape: `owl:Restriction` appears 1788 times in that
file, `owl:someValuesFrom` 1787, and cardinality restrictions never — which is
what made a single rule sufficient.

## 2026-08-07 — who decompresses is not the client's decision to make

`app/public/kg/d3fend.ttl.gz` was fetched in the worker and piped through
`DecompressionStream('gzip')`, because the manifest said `gzip: true`. It failed
with `TypeError: Failed to fetch` and nothing else — a network-shaped message for
a decoding bug, which sent me looking at URLs and CORS.

Vite's dev server recognises the `.gz` extension and serves the file with
`Content-Encoding: gzip` (and `Content-Type: text/turtle`), so the **browser**
had already inflated it. Decompressing plaintext errored the stream, and
`new Response(erroredStream).text()` rejects with Chrome's generic "Failed to
fetch". A static host or CDN may send the same bytes with no encoding header and
leave them compressed — so neither behaviour is wrong and neither can be assumed.
Sniffing the two magic bytes `1f 8b` covers both, and the transfer stays
compressed either way, so nothing is lost by not declaring it.

A second, independent bug was hiding behind it: a relative `fetch` inside a Worker
resolves against the **worker script's** URL, not the page's, so
`kg/d3fend.ttl.gz` asked for `/src/query/kg/d3fend.ttl.gz`. URLs for a worker have
to be resolved on the main thread against `document.baseURI`, which is also the
only place a non-root Vite `base` is visible.

Rule of thumb: when an error message names a *layer* (network) that the change
did not touch, suspect the message before the layer.

## 2026-08-07 — a prefix map handed to a serializer is not a display convenience

Adding SPARQL meant naming two new kinds of graph, `K:` for a loaded knowledge
base and `Q:` for a CONSTRUCT result. The obvious home was `PREFIXES` in
`rdf/emit.js`, next to `G:` and `E:`. That would have rewritten all 14
`test/snapshots/*.trig` files.

`toTurtle` passes `PREFIXES` straight to n3's `Writer`, and n3 emits **every**
prefix it was given whether the output uses it or not — visible in any existing
snapshot, which declares `E:` while containing no enrichment quads. So that
object is not a lookup table for shortening IRIs; it is the literal header of the
TriG pane. Two prefix sets now exist: `PREFIXES` for the document, and
`query/queryPrefixes.js` for the query preamble and the results table, with
`curieWith(iri, prefixes)` extracted so both can shorten IRIs against their own.

The near-miss worth remembering: the change looked purely additive and would have
passed as "regenerate the snapshots". The snapshots were the thing telling me the
serializer's contract was not what I assumed.

## 2026-08-07 — reordering a shared keymap to override one binding costs more than sidestepping it

The SPARQL pane needs `Ctrl+Enter` to run a query, but `createTextEditor` binds it
to flushing the debounce, and CodeMirror gives earlier entries in a `keymap.of`
array precedence. Moving the caller's `keyBindings` to the front of that array was
the one-line fix, and I wrote it down as behaviour-preserving because neither
existing pane binds `Ctrl+Enter`.

It is not: `createEditorPane` passes `completionKeymap` through `keyBindings`, so
the reorder changes which handler sees `Enter`, `Escape` and the arrows while a
completion is open in the mermaid editor. The direction happens to be toward
correctness, which is exactly what makes it a bad thing to change while doing
something else.

The sidestep was already there — `extensions` are spread *before* the shared
keymap, and extension order is precedence in CodeMirror — so the pane passes its
own `keymap.of([...])` as an extension and the shared array is untouched.

Rule of thumb: when a fix needs to outrank existing behaviour, look for a
mechanism that layers over it before one that reorders it.

## 2026-08-07 — a syntax the target renderer rejects is not a supported syntax

`testcases.md` documented `c <---|d3f:reads| d` as "the arrow points left", with a
snapshot asserting the reversed triple. Mermaid has no back arrow: `<--`, `o--`
and `x--` only *open* a link that a head on the right has to close, so that line
never rendered in the preview next to the graph it fed. The parser was more
permissive than mermaid in one direction (accepting `<--`) and less in the other
(`--o` and `--x`, which mermaid does draw, were reported as unrecognized
statements) — and `c o--|p| d` slipped the `o` into the endpoint group, emitting
`<urn:d3fend-graph:c o>`, an IRI with a space in it.

Two things came out of fixing it. The heads decide the meaning, not the dashes:
none on the left is forward, one at each end asserts both directions, one on the
left only is an error. And the grammar now lives in `parser/linkGrammar.js`
because three consumers had to agree about it — the edge parser, the arrow mask
behind id tokenizing, and the new diagnostic — which is the drift
[ADR 0017](docs/adr/0017-go-to-mermaid-source.md) listed as a con.

The `o`/`x` heads are the part worth remembering: both are legal id characters, so
`repo-->|p| b` reads as `rep` + `o-->` unless the head is required to sit where an
id cannot end (`(?<=[\s&])[ox]`).

Rule of thumb: when a fixture asserts what a diagram *means*, check first that the
renderer accepts it. A test can happily pin the behavior of a line nobody can draw.

## 2026-08-07 — a view-derived id cannot carry a selection across the change that rewrites it

Moving the edge swap from a left click to `s`
([ADR 0019](docs/adr/0019-select-and-swap-edges.md)) needed the selected edge to
survive the re-render the swap causes. `graphPane.update()` already carried the
selection across by id, which is right for a node and wrong for an edge: an edge
id is `` `${source}->${target}:${predicateLabel}` `` (`viz/toCytoscape.js`), so a
swap rewrites all three parts of it. Restoring by id would have dropped the
selection on the very keystroke that acted on it — swap once, then nothing to
swap back.

The fix is to match on what the change does *not* touch: the written predicate
(never the inverse label) and the pair of endpoints, compared unordered because
their order is exactly what moved.

Rule of thumb: before persisting a reference across a re-render, ask which parts
of the identifier the re-render itself rewrites. A derived id is only stable
under changes that do not touch what it was derived from.

## 2026-08-07 — parser tests must not assert on the example diagrams

`app/test/parser.test.js` asserted ids, labels and predicates read out of
`app/src/data/examples/*.md`. Those files are documentation: `83853dd` renamed
`d3f:executes` → `d3f:runs` in `local-git.md` and `4e5c4bd` rewrote the
`ssh-authentication.md` labels, breaking three tests that were not about the
parser at all.

Syntax coverage belongs in `app/src/data/examples/testcases.md`, one section per
case, snapshotted as turtle by `rdf-emit.test.js` — chained arrows, `&`-groups,
every node shape and `classDef` handling were already covered there. What stayed
in `parser.test.js` is only what a turtle snapshot cannot express: `dotted`
(dropped by the emitter on purpose), `warnings`, and the document level above a
single diagram. The examples keep a content-free smoke test: each parses into at
least one diagram with nodes, nothing more.

Rule of thumb: if an assertion would survive re-modelling the diagram, it belongs
in a test; otherwise it belongs in a `testcases.md` section with its snapshot.

## 2026-08-07 — a control that has a shortcut has to print it

The four graph-header chips had their chords in `CHIP_SHORTCUTS` only: `Alt+V`
reached the tooltip by a one-off line in `main.js`, `Alt+T`/`Alt+L` reached
nothing (`setCount` overwrote the title), and Nodes had no chord at all. Same
rule as the right-click menu's hints and the tabs' `Alt+…`: an undiscoverable
shortcut may as well not exist, and a chip that is the only way to a popover is
where its chord is learnt.

Fixed by giving `createFilterChip` a `shortcut` option that owns both the printed
`.filter-chip-key` span and the tooltip suffix `setCount` re-applies, and adding
`Alt+N` for Nodes so no chip is mouse-only. Two tables now have to agree —
the per-chip `shortcut` string and `CHIP_SHORTCUTS`, which is keyed on
`event.code` because `Alt` composes characters on some layouts.

## usage breakdown

Last 24h · these are independent characteristics of your usage, not a breakdown
68% of your usage came from subagent-heavy sessions
Each subagent runs its own requests. Be deliberate about spawning them — and consider configuring a cheaper model for simpler subagents.
31% of your usage was at >150k context
Longer sessions are more expensive even when cached. /compact mid-task, /clear when switching to new tasks.
13% of your usage came from subagents under "Explore"
If this runs frequently, consider configuring its subagents with a cheaper model or tightening their prompts.
Skills
% of usage
/d3fend-expert
3%
/markdown-editor
3%
Subagents
% of usage
Explore
13%
Plan
4%
d3fend-expert

## 2026-08-28 — the results table had no exit, and the clipboard helper was trapped in main.js

"A button to copy SPARQL results as a table" is two questions. The format one has
a plain answer: TSV. Excel, Sheets and LibreOffice all turn tab-separated
clipboard text into real cells, and TSV needs no quoting rules, while a markdown
pipe table pastes into a spreadsheet as one blob. The one real hazard is a
literal holding a tab or a newline — on paste it would become an extra cell or an
extra row, so `resultTsv` flattens those to a space. Copy what is *shown* (short
CURIEs, quoted literals) so the clipboard matches the screen, and copy only the
rows `ROW_CAP` kept, which is what the warning above the table already promises.

The second question was where the button could live. `copyToClipboard` and
`wireCopyButton` were private to [main.js](app/src/main.js), but the results
table is built inside [resultsView.js](app/src/query/resultsView.js), which
`main.js` does not wire per element. Rather than thread a callback through
`renderQueryResults`, the two helpers moved to
[clipboard.js](app/src/clipboard.js) unchanged. A helper that three panes use is
not a detail of the module that happened to need it first.

Note for the next button: the `copied` / `copy-failed` feedback styles are
attached to `.copy-button`, not to the newer `.btn` primitive, so a button that
wants the "Copied!" flash must still carry the old class name.

Environment: `node` is not on the host PATH here; the suite runs in the
`node:24-alpine` image over the mounted `app/` directory. Three failures in
`filter-panel`, `legal-queries` and `link-kind` predate this change and touch
none of its files.

## 2026-08-08 — Ctrl+Space can be unavailable on Linux due to IME/global shortcut capture

When completion is wired correctly in CodeMirror but Ctrl+Space does nothing,
the key event may be intercepted by desktop input-method switching (ibus/fcitx)
before the browser receives it. The app had no global Ctrl shortcut blocking it.

Added explicit completion trigger fallbacks in the editor keymap:
Ctrl+Shift+Space and Ctrl+.

Rule of thumb: for critical editor actions on the web, include at least one
alternate shortcut that avoids common OS-level reserved combinations.

## 2026-08-08 — Ctrl/Cmd-click should mirror hierarchy lookup, and missing npm blocks runtime verification

Users expect d3f term discovery through multiple gestures: Ctrl+Space for
completion and Ctrl/Cmd-click for direct lookup. Wiring Ctrl/Cmd-click to the
same hierarchy popover logic used by Mod-Alt-h keeps one source of truth for
definition/hierarchy rendering and avoids divergence between gestures.

Runtime test execution was blocked because npm is not installed in the current
environment (`npm: command not found`), so verification fell back to static
editor diagnostics (`get_errors`) on all changed files.

Rule of thumb: when a token-level help feature exists, expose it on both
keyboard command and modifier-click paths, and report clearly when runtime
checks cannot run.

## 2026-08-07 — flow-focus dimming needs mid-opacity to preserve graph context

Path focus at `node.path-focus-dim { opacity: 0.2; text-opacity: 0.3 }` hid too
much context. Raising those to `0.45` and `0.6` keeps non-focused nodes readable
while still clearly emphasizing reachable flow.

## 2026-08-08 — tests should only use supported mermaid link-label syntax

`matchD3fToken` tests used `A --hardens--> d3f:Vulnerability` and
`d3f:A --relates--> d3f:B`, but dashed in-text labels are intentionally
unsupported in this repo. Rewriting fixtures to `-->|d3f:...|` keeps tests aligned
with parser/link grammar constraints from README.

Runtime verification was blocked in this environment because `npm` is missing
(`npm: command not found`), so only static validation could be performed here.

## 2026-08-08 — edge endpoint node declarations must be normalized through the node parser

`collectSymbols` is not covered by `testcases.md` snapshots: it indexes editor
symbols from markdown diagrams, while testcases assert RDF emission semantics.
The failure in `document-symbols.test.js` came from `parseEdgeLine` treating
`DB[(Store d3f:Database)]` and `LOG[Audit log]` as literal ids instead of node
declarations.

Fixing `parseEndpointToken` to reuse `parseNodeStatement` keeps endpoint ids
canonical (`DB`, `LOG`) and still extracts label/classes for inline endpoint
declarations.

Rule of thumb: for contextual dimming in dense graphs, start near 40–50% node
opacity and tune from there; below ~30% quickly becomes unreadable.

## 2026-08-07 — directional flow focus works best as graph-level classes, not filter-state rewrites

To show architecture flows from a selected node, rewriting predicate/node filters
would have mixed a temporary exploration gesture with persisted view state
(`filterPanel` + localStorage). Keeping flow focus inside `graphPane` as
class-based highlighting avoids that coupling: selection and filters stay the same,
while visible nodes/edges are dimmed or emphasized according to a directed
reachability pass over the currently drawn graph.

Rule of thumb: when the feature is an ephemeral reading aid ("show me this flow
now"), keep it in render-layer classes and keyboard state, not in persisted
filter state.

## 2026-08-07 — when command execution is unavailable, validate through editor diagnostics and report the gap

Running `npm test` failed because `npm` (and `node`) are not available in the
current execution environment. The implementation was still validated by checking
workspace diagnostics on all changed source and test files (`get_errors`), which
reported no errors.

Rule of thumb: if runtime/tooling is missing, do the strongest static validation
possible, then report exactly what was not runnable and why.

## 2026-08-08 — test the pure decision, not the DOM, when the suite has no DOM env

`d3fend-hierarchy-popover.test.js` threw `document is not defined`: the suite has
no jsdom/happy-dom and every other test is DOM-free. Rather than add an
environment the rest of the suite does not use, the click decision was extracted
out of `createHierarchyPopover` into `hierarchyTargetAt(state, pos)` and
`modClickTarget(event, view)`, and the test now asserts on those.

The original test was doubly wrong: `popover.modClick.mousedown(...)` cannot work
because `EditorView.domEventHandlers()` returns a CodeMirror extension, not the
handler map it was given.

Rule of thumb: when a test reaches for a browser global, first ask whether the
logic under test needs the DOM at all.

## 2026-08-08 — "completion doesn't work" was the trigger condition, not the keymap

`Ctrl-Space` was bound three times over (`COMPLETION_TRIGGER_KEYS` plus
`completionKeymap`, itself already `Prec.highest`), so the key was never the
problem: `d3fendCompletionSource` matches `/d3f:([\w-]*)$/`, so it declines every
position where the colon has not been typed yet. Reading the completion source
before the keymap would have found that in one step.

Two gaps in the CodeMirror defaults, both now closed: `completionKeymap` binds
`Enter` to accept and nothing to `Tab`, and `hoverTooltip` hides only on pointer
move — `Escape` needs a `hideOn` predicate driven by a `StateEffect`, because
there is no public "close the hover tooltip" command.

`Tab` as `acceptCompletion() || startCompletion()` was wrong for a second reason:
a session survives as long as the typed text still satisfies its `validFor`, so
on `d3f:a` the first branch won and silently took the preselected row. `Tab` now
only opens the list; `Enter` accepts.

Merging hover and hierarchy afterwards showed where the duplication had come
from: both drew `hierarchyText` — which already lists path, parents and children —
and the popover then drew its own breadcrumb and its own parent/child buttons on
top. Naming the content once (`termSections`) and rendering it once
(`renderD3fendCard`) was the fix; `hierarchyText` survives only because the
completion popup's `info` pane takes a string, not DOM.

I first kept both surfaces and gave the popover the only interactive copy. Wrong:
the ask was one card. A CodeMirror hover tooltip stays open while the pointer is
inside it (`isInTooltip` in the view's `HoverPlugin`), which is what makes the
buttons clickable and made the whole popover module — `Mod-Alt-h`, Mod-click,
`hierarchyTargetAt` and its test — deletable. Worth checking whether the platform
already does the thing before building a second surface to do it.

The list also never appeared on screen. Nothing in the completion code explains
it, so the first thing removed was the layout: `tooltips({ parent: document.body })`
takes every tooltip out of `.cm-editor` and away from the `overflow: auto` panes
that could clip it. Worth remembering that this is a guess until the browser
console is read — with no way to run the app, a plausible cause is not a diagnosis.

## 2026-08-08 — the boot path chose the storage backend, not the data size

"Save my documents in the browser" reads like an IndexedDB task until you look at
where the read has to happen: `createEditorPane(host, initialText, onChange)`
fires its first `onChange` synchronously, so `initialText` is computed
synchronously, so the load is synchronous. IndexedDB would have made the whole
startup path async to store a few KB — and the suite has no jsdom or
fake-indexeddb, while `localStorage` is the three-method stub four existing tests
already write. The constraint was in the boot ordering in `main.js`, not in the
requirements.

Two shapes of key, not one blob: autosave fires on every keystroke burst and only
needs the index, so contents live under `d3fend-graph:files/<id>` and are written
only when the file list actually changes. Orphans are pruned by diffing against
the index already on disk rather than enumerating `localStorage` — enumeration
would mean reasoning about keys other modules own, and the test stub does not
even expose `key(i)`.

A dirty badge cannot be one rule. With a file behind the working copy it is a
content comparison, so editing back to what was saved clears it; with no file —
a freshly loaded example — there is nothing to diff, and a `pristine` bit is what
keeps the badge from being lit from boot and meaning nothing.

Where `layout/persist.js` swallows a failed write on purpose, this one reports
it: losing an arrangement costs a drag, losing a document costs the work. Same
reason the size limits refuse rather than evict — deciding which of the user's
documents to drop is not the storage layer's call.

## 2026-08-10 — a symmetric relation is two triples but one thing to read

`<-->` and self-inverse predicates like `d3f:connected-to` put both directions in
the store, and the view drew both: two beziers, two labels, two clickable
elements saying the same thing. Merging them into one link with a head at each
end belongs in `toCytoscape.js`, beside the fold, not in `graphModel.js` — the
model stays one entry per quad, so the TriG pane, the counters and SPARQL keep
seeing what the store holds.

The merge is the easy half. The hard half is everything that assumed one
direction per element: `writtenTriplesOf` (`g` must reach both mermaid lines),
`edgePanelSummary` (the panel is the only place that says "asserted both ways"
in words), `directionalFlow` (a flow must not depend on which of the two triples
became the source end), and `foldedFrom`/`foldedTo`, whose "endpoints as drawn"
contract means a reciprocal member contributes its *object* to the source end.
Grepping for `data.source` reaches all of them; grepping for the new flag would
not have, since none of them mentioned direction.

Colour is a separate axis from arrowhead: `edge[bidirectional]` sets
`source-arrow-shape` only, and `source-arrow-color` is set unconditionally on the
base and tactical-verb rules. Otherwise the two-way rule would have to repeat
every kind's colour, or a green tactical link would grow a grey tail.

Also: `grep` without `-a` silently skipped `graphPane.js` entirely, which read as
"path focus is not wired up". Check with `-a` before concluding a symbol does not
exist.

## 2026-08-10 — measure the transformation before designing around it

The first plan for the legal knowledge base pruned DPV's editorial triples and
re-serialised through rdflib, with a blank-node GC and deterministic skolemisation
to keep the output stable. Downloading the modules and running `cat | gzip -9`
took one command and settled it: 165 KB verbatim against 255 KB pruned, because
upstream's grouped Turtle compresses better than sorted N-Triples. The pruning
also deleted every `dct:creator`/`dct:license` triple — DPV is CC-BY — so it was
destroying attribution to make the file bigger. Verbatim concatenation is also
byte-stable for free, since the bytes are upstream's, which was the whole reason
the skolemisation existed.

Two facts worth keeping: Turtle allows `@prefix` redeclaration mid-document and no
DPV module uses `@base`, so plain concatenation is valid; and DPV's hierarchy is
mixed — `skos:broader` inside a family, `rdfs:subClassOf` at the top — so
`skos:broader+` stops one hop short of the family root and under-reports without
failing. There is now a test that documents that trap by asserting the two paths
return different sets.

The structural constraint that shaped everything else: a SPARQL property path is
evaluated inside one `GRAPH` binding, so splitting a vocabulary across named
graphs truncates every walk and returns a shorter, plausible-looking answer. That
alone decided "all modules in one graph", and it turned a three-graph design into
two — generated versus hand-authored, which is the only split that survives a
rebuild.

## 2026-08-10 — a bare local name stopped being an identity

Hover and completion keyed terms by D3FEND local name (`getItem('Password')`).
Adding `dpv:` and `ob:` made that ambiguous, and the fix was to make the **qname**
the identity everywhere in `editor/`. The refactor was mechanical, but two callers
outside that folder were keyed on the old shape and neither was obvious:
`viz/icons.js` walks parents to find an inheritable icon, and `viz/edgePanel.js`
stripped `d3f:` off a predicate before looking it up — the latter got simpler,
since the CURIE as written is now the key.

Building the hover regex and the completion triggers from the same registry, rather
than writing both by hand, is what makes "hoverable" and "completable" the same set.
It also fixed `d3f:AML.T0000` by accident: `.` had never been in the local-name
charset, so the ATT&CK ids in the projection were unreachable from either surface.

## 2026-08-10 — session state: legal knowledge bases landed, Compliance view not started

Where this stands, for whoever picks it up. The plan is
`~/.claude/plans/i-want-to-explore-humble-cocke.md`; the decisions are
[ADR 0025](docs/adr/0025-legal-knowledge-bases.md).

**Phase 1 is written and committed to the working tree.** Two knowledge bases —
`legal` (DPV 2.3 + risk/tech + EU GDPR/NIS2/AI Act, built) and `regulation`
(hand-authored obligations + 15 D3FEND mappings, plain turtle). Legal prefixes are
in `queryPrefixes.js` so they are in every preamble. Six queries, `08`–`13`. Hover
and completion generalised past `d3f:` through `editor/vocabularies.js`. Five new
test files, plus three editor tests updated to the qname signature and
`query-library.test.js` tightened from ⊇ to = on `needs:`.

**Not yet verified, because this session could run neither npm nor the scripts.**
What *was* verified: all 14 `.rq` files parse under rdflib's SPARQL parser and
satisfy the library invariants, `regulation.ttl` parses, and every `d3f:`/`dpv:`
IRI in it resolves against `d3fend-completions.json` and the real `dpv.ttl`. Still
to run:

```sh
python3 app/scripts/build-legal-kg.py --fetch --ref <tag> --verify
python3 app/scripts/build-legal-metadata.py
cd app && npx vitest run
```

Until the first runs there is no `app/public/kg/legal.ttl.gz`:
`knowledge-bases.test.js` tolerates that for a `.gz` entry that declares a
`missingHint`, and `legal-kg-live.test.js` skips itself. Until the second runs
`legal-completions.json` is `{}`, so `dpv:`/`ob:` hover and completion stay silent
— the registry skips a vocabulary with no terms on purpose, and
`vocabularies.test.js` skips its legal cases. Set the `legal` entry's `tripleHint`
to whatever `--verify` reports.

**Wants review, not code:** the 15 mappings are `al:Draft`. Two obligations are
permanent gaps — staff training, and the pseudonymisation limb of GDPR 32(1)(a) —
because D3FEND has no technique for either. That is deliberate, and it is also the
fixture `legal-queries.test.js` asserts the gap query against, so do not "fix" it
by inventing a mapping.

## 2026-08-11 — D3FEND has no "data vs processing" subtree

Wanted a single ancestor covering `d3f:File`, `d3f:WebResourceAccess`,
`d3f:DatabaseRecord` so diagrams could split data from processing. The lowest
common ancestor is `d3f:DigitalInformationBearer`, and it is the wrong cut:

```text
Artifact → DigitalArtifact → DigitalInformationBearer → Resource → File
                                                      → Record   → DatabaseRecord
                                                      → UserAction → ResourceAccess
                                                        → NetworkResourceAccess → WebResourceAccess
```

`DigitalInformationBearer` has 68 direct children / 601 descendants, including
exactly the processing side: `Process`, `Thread`, `SystemCall` (42),
`ComputerPlatform` (58), `NetworkNode` (58), `HardwareDevice` (58),
`OperatingSystem`, `HardwareDriver`, `Sensor`, `IntrusionDetectionSystem`,
`UserInterface`.

The sibling branch does not help. D3FEND splits `DigitalArtifact` into *content*
vs *carrier*, not data vs processing:

- `DigitalInformation` (294) — `Software` (234), `Command`, `CryptographicKey`,
  `Identifier`, `Metadata`, `DigitalMedia`…
- `DigitalInformationBearer` (601) — files, records, packets, **and** processes,
  hosts, devices.

So `Software` sits on the "information" side while `File` sits on the "bearer"
side. The axis does not exist as a subtree; it has to be an explicit root set.
Data-ish roots under `DigitalInformationBearer`: `Resource` (123, incl. `File`),
`Record` (15), `DigitalMessage` (48), `Database` (10), `Storage` (10), `Log` (5),
`FileSection` (7), `FileSystemLink` (12), `Credential` (13), `Directory`,
`FileSystem`, `Certificate`, `BinaryLargeObject`, `Clipboard`, `NetworkTraffic`
/ `NetworkPacket` / `NetworkFrame`. `ResourceAccess` (4) is an *action*, not a
bearer, so `WebResourceAccess` arguably belongs in a third bucket.

Related: `nodeKind.js` lists no per-class entries on purpose. Classification is
per *top branch* — `build-d3fend-categories.py` walks `rdfs:subClassOf` to the 14
children of `d3f:D3FENDCore`, `coreCategoryOf` picks one, `nodeKind.js` maps only
that. A data bucket therefore means a second pass in the build script emitting a
`data` flag, plus deciding whether it gets its own colour: today bucket == colour
because both derive from `coreCategory`.

Hierarchy queried with the `d3fend-expert` skill's Oxigraph store — the repo's
`d3fend-categories.json` only records the top branch, so it cannot answer
ancestor questions.

**Phase 2, untouched:** the Compliance view — a coverage matrix at `Alt+C`, fixed
per-framework queries in `app/src/data/compliance/`, a pure `complianceModel.js`
plus renderer, recompute on Refresh only with a stale banner. Its one hard rule:
a legal knowledge base that has not downloaded must never render as an all-gaps
matrix, because that is indistinguishable from a genuinely non-compliant design.

## 2026-08-12 — the missing bucket was a structural question, not a taxonomic one

Sequel to the entry above, and the resolution of it. The question was how to make
a diagram that reifies its messages (`client -produces-> requests -executed-by-> api`) read as message passing rather than as a bipartite artifact graph. The
answer — ADR 0026 — needs to recognise a "payload", and the day before that looked
like it needed the data-vs-processing bucket that does not exist.

It does not. **A node is a payload by what it does, not by what it is:** one
producing link in, one consuming link out, nothing else. That matches
`WebResourceAccess`, `DatabaseQuery`, `DatabaseRecord`, `EventLog` and `File`
without naming any of them, matches untyped nodes too, and cannot be wrong about
`d3f:Process` — a process that is produced by one thing, read by one thing and does
nothing else *is* being used as a payload in that diagram. `coreCategory === 'Artifact'` would have been wrong in both directions: `Process`,
`WebServerApplication` and `DatabaseServer` are all Artifacts, while `EventLog` is
`['Log']` and so has no core category at all. The one taxonomy check worth keeping
is a *veto* (`Agent`/`Plan`/`Goal` is never a message), which needs no new data
because `nodeKind` is already on the model node.

Three things that fell out, worth remembering as shapes:

- **Where a transform goes is decided by what it changes.** This one changes the
  element set, so it goes in `toCytoscape.js` and is a View preference;
  `layouts.js` decides only *where* elements go and must stay pure geometry. It is
  also the first View pref needing a rebuild rather than a restyle, which is two
  lines in `main.js` rather than a wider `graphPane` contract.
- **Run a derived-element pass after the filters, not before.** Feeding it
  `visibleEdges` means hiding either leg leaves the path incomplete and the
  payload is *drawn* — the filter stays authoritative for free, instead of a
  derived arrow quietly undoing it.
- **`foldedFrom`/`foldedTo` cannot express two predicates.** They are two endpoint
  sets read against one predicate; a collapsed path is two triples with two
  different predicates. Hence `standsFor`, hence a branch in `writtenTriplesOf`
  and `pair.predicate ?? summary.drawn` in `renderEdgePanel`.

Also settled, and worth not re-deriving: `d3f:read-by`, `d3f:written-by`,
`d3f:decoded-by`, `d3f:transfers`, `d3f:transferred-by` **do not exist in D3FEND**
— they are display labels `inverse-map.json` invents for the edge swap, checked
against the 293 `"kind": "property"` entries in `d3fend-completions.json`. Their
removal from `DATA_FLOW_PREDICATES` was right, and it removes a whole class of
problem: every composable predicate is in that set, so the collapse depends only on
the `data-flow` kind being visible and never on `other`. (`d3f:may-be-produced-by`
and `d3f:may-be-executed-by` are still in the table and also do not exist —
harmless, noted in `ISSUES.md`.)

**What this does not do:** ordering. `client → api` and `api → client` remain an
antiparallel pair with nothing saying which came first, so the graph stays cyclic
and `elk-layered` cannot lay it out as a sequence. Nothing anywhere carries a step
index — `arrowIndex` is excluded from the RDF path by name, and `model.edges` order
is `store.getQuads()` order. A real sequence view needs an ordinal in the RDF; that
is a separate change.

Also corrected a stale README limitation while there: chained arrows on one line
*are* supported and have been since `edge-forms` in `testcases.md`.

**One raw NUL byte made `graphPane.js` invisible.** `reselectEdge`'s separator was
typed as a literal NUL rather than built, so git classified the whole 543-line module
as binary — `git diff` showed `Bin 21347 -> 21625 bytes` instead of a patch — and
`grep`/`rg` skipped the file silently, which is a genuinely dangerous failure mode:
searching for a symbol in it returns *nothing*, not an error.
`String.fromCharCode(0)` keeps the value and the file stays text. Worth checking for
elsewhere: `git ls-files | git check-attr --stdin -a` or just looking for `Bin` in
`git diff --stat` on a file that should be source.

## 2026-08-12 — the build had no idea where it would be served from

`npm run build` emitted `/assets/…` into `dist/index.html`, so copying the tree
under `ioggstream.github.io/d3sign/` produced 404s at the site root. Nothing was
wrong with the code — Vite's `base` simply defaults to `/`, and the app had never
been deployed anywhere but the root.

`base: process.env.VITE_BASE || './'` in [app/vite.config.js](app/vite.config.js)
makes the same `dist/` work at any depth. The rest of the app was already
deploy-agnostic and needed no change: `index.html` uses source paths (`/src/main.js`)
that Vite rewrites, the SPARQL worker and oxigraph wasm resolve through
`import.meta.url`, and the knowledge bases are declared relative (`kg/d3fend.ttl.gz`)
and resolved against `document.baseURI`. Worth remembering: relative-by-default
plus `document.baseURI` is what made a one-line fix sufficient — absolute
`/kg/…` URLs anywhere would have turned this into a sweep.

## 2026-08-12 — the mermaid editor scrolled via its host, not via CodeMirror

"Scrolling stopped working" in the mermaid pane was a CSS regression from the UI
cleanup (bf02198): the host rule in [app/src/styles/app.css](app/src/styles/app.css)
gained `overflow: hidden`, and `#editor-host` is in that selector list. It had been
scrolling by accident — `.cm-editor` grows to the full document height and the host's
earlier `overflow: auto` moved it. `#turtle-host` and `#query-host` never depended on
that: both already had `.cm-editor { height: 100% }` plus `.cm-scroller { overflow: auto }`,
so they kept scrolling and only the mermaid pane broke.

Fix: give `#editor-host` the same two rules, keeping the font-size override for the
other two only. Lesson: a CodeMirror pane inside a bounded flex host must scroll
*inside* CodeMirror. Relying on the host's `overflow` works until someone changes it,
and it also defeats CodeMirror's viewport virtualization — the whole document is laid
out. When two of three sibling panes carry an explicit rule and the third does not,
that asymmetry is the bug waiting to happen, not a simplification.

## 2026-08-13 — the node panel was reading a different ontology than the SPARQL pane

A `d3f:User` panel showed one relation. The ontology states four. The gap was not a
filter on digital artifacts — there is none — but
[build-d3fend-metadata.py](app/scripts/build-d3fend-metadata.py) reading *direct
triples only*, while D3FEND states most relations as
`rdfs:subClassOf [ owl:onProperty … ; owl:someValuesFrom … ]`: 1787 such triples,
1647 of them between two known classes. The same rewrite already existed a few
directories away, in `queryEngine.js`'s `MATERIALIZE_RESTRICTIONS`, and
[lessons.md](lessons.md) had already recorded that rdflib's `predicate_objects`
misses them. Two views over one ontology, two extraction paths, one of them a
year behind the other — the fix was to make the build do what the query engine
does, not to invent a rule.

Second lesson from the same panel: `classify()` returned `"defense"` for anything
without a `d3f:attack-id`, so a section headed DEFENSE listed
`User d3f:has-account UserAccount`. A binary that means "not the other thing" is
not a classification; the real predicate was membership in the
`d3f:DefensiveTechnique` subclass closure (273 classes here), and everything else
needed its own bucket rather than the nearest existing one. Checking the outliers
mattered: the ~226 classes that carry a `d3f:d3fend-id` yet sit outside the
closure turned out to be analytic/ML method classes, which confirmed the closure
was the right rule instead of a lossy one.

Also worth keeping: the ontology asserts some relations *twice*, once directly and
once as a restriction, so unioning the two sources needs a dedup key — and the
absolute `--fs-*` scale had to become `em` before a single slider could size the
panel, except on the one rule shared with `.query-reveal` outside it. The panel's
`width` had to follow into `em` as well: a bigger font inside a fixed 480px column
does not make a bigger panel, only a narrower one that wraps more and grows
downwards. "Text size" is a size of the box, not just of the glyphs.

## 2026-08-13 — a library's error path can write outside your container

Broken mermaid blocks filled the main window with stacked error graphics. The
bug was not in our rendering code but in mermaid's *failure* path: called as
`mermaid.render(id, text)` with no container argument, it creates a temp
`div#d<id>` on `document.body`, paints the "bomb" SVG there, and only removes it
when `suppressErrorRendering` is set. With a fresh id per render, its own cleanup
never matched the previous leftovers either, so one orphan accumulated per
keystroke. The same flag also decides whether a *parse* error rejects or resolves
with the error diagram — so without it our `catch` never ran and the `onError`
callback was handed `null` on the exact case it existed for.

Two things worth carrying: when a library takes a "where to render" argument,
find out what it does when you omit it *and* fail; and a success callback that
fires on failure is the tell that the library has an error-rendering mode you
have not configured.

## 2026-08-13 — a disabled feature hides the bugs in the code that would have run it

Letting the info panel's "+" add attack and restriction rows, not just defensive
ones, was a two-line change to which sections get the callback — the insertion
rule was already kind-blind and direction-correct. What it *uncovered* was a
latent bug two layers away: `nodeParser.js`'s `CLASS_TOKEN_RE` was
`/d3f:[A-Za-z0-9-]+/`, so the label `d3f:T1548.001` the new attack rows write
parsed as the class `d3f:T1548` plus a stray `.001` label — typing the node as the
parent technique. Nobody had noticed because the only writer of ATT&CK classes was
the feature that had been switched off. The fix is a dot *between* segments only
(`(?:\.[A-Za-z0-9-]+)*`), so a class ending a sentence in a hand-written label is
unaffected. Lesson: when you enable a path, grep for what it now feeds, and be
suspicious of charsets that were only ever exercised by the easy case.

Two smaller things. The marker line the additions are written under
(`%% Added via UI`) is free precisely because the tokenizer strips `%%` before
anything sees it — the regression worth guarding is not the RDF but the *index*:
if a comment line ever produced a source location, the next addition would anchor
on it. And a "separate mermaid block for additions" is tempting (its own named
graph, hideable, deletable in one go) but loses the anchor's `subgraph` membership,
which is the thing the in-place rule exists to keep; a comment gives the
traceability without the loss.

Also: a tooltip that repeats down thirty rows ("Add to the diagram") is the same
as no tooltip. Naming the row's own class, predicate and direction is what makes
it an explanation instead of a label.

## 2026-08-13 — D3FEND files attacks and defences on the same branch

"Attacks must be red" was not a styling tweak: `d3f:T1110.001` and
`d3f:DecoyPersona` both resolve to the `Plan` branch in
[d3fend-categories.json](app/src/data/d3fend-categories.json), so `CATEGORY_COLORS`
drew a brute-force technique and the decoy that catches it in the same green. The
branch table cannot answer "whose plan is this?" — that needs the
`d3f:OffensiveTechnique` closure, and *also* `d3f:attack-id`, because neither
covers the other: the closure holds 15 abstract tactic parents with no id, while
633 techniques with an id (ATLAS `AML.T*`, ICS `T0*`, `EXF-*`) sit outside it. 866
classes in the union.

The design decision worth keeping is what it is *not*: not a fifth `coreCategory`
and not a fifth node kind. A node kind would have been the tidy-looking choice and
would have silently hidden every attack for existing users — `visibleNodeKinds`
falls back to "everything I know" only when the saved payload is absent, so a
payload written yesterday means "the four kinds, and not the new one". Colour and
bucket are now allowed to disagree on purpose, with the reason written where the
invariant used to be.

Same change, unrelated lesson: a generated node label is part of the feature, not
polish. `t1110_001` on its own is a technique number; `[d3f:T1110.001 Password Guessing]` is the node the reader wanted. And 100 D3FEND labels carry brackets or
parentheses (CWE titles), so writing a label into mermaid means sanitizing what
would close the shape and quoting the rest.

## 2026-08-13 — a vocabulary can be readable and unwritable, and nobody notices

ADR 0025 made every DPV term completable and hoverable. What it did not do is let
a diagram *write* one: `CLASS_TOKEN_RE` in
[nodeParser.js](app/src/parser/nodeParser.js) matched `d3f:` alone, so
`dpv:PersonalData` was autocompleted, explained by a hover card, and then stripped
into the free-text label. Every failure in this feature had that shape — silent
degradation, never an error. `shortLabel` printed a raw
`https://w3id.org/dpv#PersonalData` as the node's label line *and* handed it to
`resolveIconName`; `coreCategoryOf` returned null; `nodeKind` said `other`; the node
panel's `d3fClassLocalNames` filtered the definition away so a DPV node's panel was
a bare RDF table. Four sites, all reading `PREFIXES.d3f` directly. Grep for the
constant, not for the feature.

**The widest useful set and the widest safe set are different sets.** Ten prefixes
are hoverable; only four may type a node. Not taste: a writable prefix is consumed
*anywhere* in a node's text, so registering `risk:` silently deletes the label from
`A[Cache risk:high]`. The line that fell out — vocabularies describing things *in*
a system versus vocabularies recording a judgement *about* one — also explains why
`ob:` and `al:` are not node types.

**A constraint recorded as a cost may just be removable.** ADR 0025 kept `ob:`/`al:`
out of `PREFIXES` because n3's `Writer` emits every prefix it is handed, so the TriG
header and 14 snapshots would gain unused declarations. `expandCurie` reads the same
map, so DPV could not be added without paying that. But `toTurtle` is four lines and
takes the map as an argument: filter it to namespaces actually present and the
objection is gone, `ob:`/`al:` included. The first attempt narrowed *all* of it and
moved 14 snapshots anyway — `E:` had always been declared unconditionally. Narrow
only what you are adding; the guarantee "existing output is byte-identical" is worth
more than a tidy rule.

**Do not guess an ontology's property names.** `dpv:hasPersonalDataCategory` reads
as though it must exist, sits neatly beside `hasDataSubject`/`hasLegalBasis`, and is
not in DPV — a category of personal data is a *subclass* of `dpv:PersonalData`, so
`pd:` terms are types on a node, not predicates on an edge. It reached a curated set
and an example diagram before a check against the projection caught it. Seven of the
eight were real, which is exactly why the eighth survived reading. The set now has
the same real-property test `artifactFlow.js` already carried.

Two smaller ones. The upstream prefix label is the right one even when it is
uglier: DPV publishes `eu-gdpr:`, the app had `gdpr:`, and the cost was that a term
pasted from the documentation silently fell through to the label. `-` is legal in a
Turtle/SPARQL `PN_PREFIX`, but the two spellings cannot coexist — `-` is a non-word
character, so the hover pattern's `(?<![\w:])` lets `eu-gdpr:X` match a second time
as a phantom `gdpr:X`. And a decision can be satisfied by deleting nothing: ADR 0028
proposed treating a DPV-only subgraph as presentational padding, which would have
needed a *new* prefix check in `isTagged` — the function only ever asked whether
`classes` was non-empty, so the correct behaviour was already there and the draft
was asking for code that made it worse.

## 2026-08-14 — one wrong return type deactivated every tooltip in the editor

`info: () => hierarchyText(qname)` looks right and is not: CodeMirror accepts a
*string* `info`, but from a *function* it accepts only a Node, `{dom}` or a Promise —
`if ("then" in infoResult)` on a string throws `Cannot use 'in' operator`. The throw
happened inside `tooltipPlugin`, and CodeMirror does not just log a crashed plugin,
it **deactivates** it (`this.spec = this.value = null`). So the first completion of
the session killed the popup *and* every D3FEND hover card, permanently, until
reload. Two symptoms that looked unrelated — "the completion list never appears" and
"hover dies after using completion" — were one line.

**A silent feature and a crashed plugin look identical from outside.** I spent this
session and the last on the geometry of a tooltip that was never created: measuring
containers, `body`'s grid, `z-index`, `-10000px`, a MutationObserver. The console had
the answer the whole time and I asked for it fourth. When a feature is wired
correctly and simply does not appear, read the console *before* reasoning about the
library — and when the state is provably alive (Tab opened a session, Enter accepted
from it) while nothing renders, suspect the renderer crashed, not that it is
mispositioned.

The fix keeps the text under `infoText`, a field the library never reads, so the
popup builds no info pane at all: nothing left to get the contract wrong about, and
the value stays a lazy plain string that the tests can call without a DOM — which
matters, because this suite has no jsdom, so "return a Node instead" would have made
`node-completion.test.js` untestable. A regression test now asserts `info` is absent
and `infoText` returns a string.

## 2026-08-13 — the completion panel was rendered into a grid cell off the screen

**Superseded as a diagnosis by the entry above: the popup was never created at all,
so none of this was why it was invisible.** The defect below is real and worth
keeping — it would have mispositioned the tooltips that now work — but it was not
the bug being hunted.

"The completion panel is not visible" was not the keymap and not the completion
source: Tab opened a session and Enter accepted from it, so the state was right and
only the painting was wrong. `tooltips({ parent: document.body })` in
[editorPane.js](app/src/editor/editorPane.js) had been chosen so no pane's
`overflow: hidden` could clip a list opened near the bottom of a pane. But
CodeMirror does not append tooltips to the parent it is given — it creates one
`position: relative` container *per editor* and appends that. `body` is a
`height: 100vh; display: grid; grid-template-rows: auto 1fr; overflow: hidden`
workbench, so three containers became grid items in an implicit row past the bottom
edge, and every tooltip measured against them landed in the clipped strip. Fix: a
`position: fixed`, zero-size `#cm-tooltip-host` at the viewport origin, out of flow
and with a `z-index` above the pane chrome.

Then the decision that should have come first: the list is now a `showPanel` strip
at the top of the editor (`completionPanel.js`), not a tooltip at all. The search
panel had been working in this app the whole time, which was the clue — a panel is
laid out by the browser inside `.cm-editor`, so there is no rect to measure and
nowhere to hide, while a tooltip's visibility depends on the caret's coordinates,
the editor's rect, the parent's rect and the space left in the viewport. When a
feature's *state* is provably correct and only its *painting* fails, stop fixing the
painting and take the mechanism that has no painting to get wrong. `currentCompletions`
/ `selectedCompletionIndex` / `setSelectedCompletion` expose the same state the popup
reads, so the keymap needed no changes.

**"Append to body" is not layout-neutral when body is a layout.** The habit comes
from apps whose `body` is a plain block container. Under a grid or flex `body`,
every library that parks an element there — tooltips, portals, modals — silently
gains a track. The right target is an element you own and have taken out of flow.

Two debugging notes. `body > .cm-tooltip-autocomplete` cannot match by
construction, because of that intermediate container — a negative result from a
direct-child selector proved nothing, and cost a round trip. And CodeMirror's
`closeOnBlur` defaults to true, so clicking into devtools destroys the element you
are trying to inspect: observe with a MutationObserver installed beforehand, or read
`style.top` — CodeMirror parks a tooltip it decides to hide at `-10000px`, which is
a different failure from a tooltip that was never created.

## 2026-08-28 — first CI: build + GitHub Pages deploy, zizmor-clean

Task: add a workflow that builds `app/` and publishes it to GitHub Pages, with
zizmor passing and remote images pinned by sha256.

Worth remembering:

- The tracked [app/.npmrc](app/.npmrc) interpolates
  `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`. npm aborts with *"Failed
  to replace env in config"* when that variable is unset — so every `npm ci` /
  `npm test` step needs `GITHUB_TOKEN: ${{ github.token }}` in its `env:`, even
  though no `@ioggstream/*` package is currently a dependency.
- `actions/configure-pages` needs `pages: read` on the job; the starter
  workflows hide this by granting `pages: write` repo-wide at the top level.
  Its `base_path` output is `"/<repo>"` for a project page and `""` for a user
  page — the `process.env.VITE_BASE || './'` fallback in
  [app/vite.config.js](app/vite.config.js) already handles both.
- Do **not** set `cache: npm` on `actions/setup-node` in a workflow that
  publishes: zizmor's `cache-poisoning` audit flags it. `npm ci` is cheap here.
- zizmor needs `permissions: {}` at the top level plus per-job least privilege
  (`excessive-permissions`), `persist-credentials: false` on checkout
  (`artipacked`), and full-commit-SHA `uses:` pins (`unpinned-uses`). Values
  reach `run:` through `env:`, never `${{ }}` inline (`template-injection`).
- `mcr.microsoft.com/devcontainers/javascript-node:1-24-bookworm` in
  [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) was
  **unpullable** — the `1-*` variant no longer publishes node 24. Pinning by
  digest is what surfaced the dead tag; the live equivalent is `4-24-bookworm`.
- Pin to the *manifest list* digest (`docker buildx imagetools inspect <ref>`,
  the top-level `Digest:`), not a per-platform one, or the image stops being
  multi-arch. For MCR, a plain
  `curl -D- .../v2/<repo>/manifests/<tag>` with the OCI-index `Accept` header
  returns `docker-content-digest`; its `tags/list` endpoint is also the quickest
  way to check a tag still exists.
- The host has no `node` at all (`app/node_modules` came from a container), so
  the build could not be verified locally — worth checking before planning a
  local verification step.

## 2026-08-28 — per-branch Pages previews, and why deploy-pages cannot do it

Task: publish PR previews at `ioggstream.github.io/d3sign/<branch>/`.

- `actions/deploy-pages` replaces the **whole** site with one artifact; a Pages
  site has exactly one deployment. Subpath previews are structurally impossible
  with it — they require the branch source (`gh-pages`) instead, which is a
  repo-settings change, not just a workflow change.
- Publishing main to the root while keeping preview directories needs a record
  of what to spare. A `.previews` manifest at the branch root is enough: wipe
  every top-level entry except `.git`, the markers, and the listed dirs.
- **`set -euo pipefail` + `grep` in a pipeline is a trap.** `find … | grep -vxF … | xargs rm` aborts the job whenever grep drops every line — which is the
  normal case on the first deploy and whenever only previews exist. Wrap it:
  `| { grep -vxF -- "$keep" || true; } |`. Caught only by actually running the
  script; the dry run and zizmor both said fine.
- Fork pull requests get a read-only token, so any gh-pages push job needs
  `github.event.pull_request.head.repo.full_name == github.repository`.
  `pull_request_target` would "fix" it by running fork code with a write token —
  do not.
- yamlfmt (`max_line_length: 60`) mangles a folded `>-` `if:` block, splitting
  `!=` and `==` onto their own lines. A single-line `if: ${{ … }}` wraps far
  more readably. Both are semantically identical; only one is reviewable.

Testing without pushing:

- `act` validated all four gates (`push` main, PR synchronize, PR closed, fork
  PR) via `-n` with hand-written `-e` payloads. Note act pads job labels
  (`[pages/build  ]`), so a `\[pages/build\]` grep silently matches nothing — it
  looked like the job was skipped when it had run fine.
- For the shell logic, parsing the `run:` blocks straight out of the workflow
  YAML and executing them against a local bare repo (substituting only the push
  URL) tested the real code end to end: first deploy, two previews, main
  redeploy, close, close-again.

## 2026-09-08 — a subgraph cannot mean "these are the members"

Task: finish the ADR 0031 draft on architecture templates (design only, no code).

- The draft referenced templates as `G:HostTemplate`. `G:` is bound to
  `urn:d3fend-graph:`, which is also the base `nodeIri()` mints — so that CURIE
  is simultaneously a named graph, a node and a class. Prefix reuse here has to
  be checked against `PREFIXES` *and* against `nodeIri`, not just the prefix table.
- **The draft's own expected TriG contradicted the emitter.** It wrapped every
  member in `subgraph host[d3f:Host]` to say "these belong to the host", and the
  containment loop in `emitQuads` writes `d3f:contains` from a tagged subgraph to
  every tagged child. So the example silently asserted that a host contains its
  hostname, domain name and addresses — while the very next line said the
  hostname `d3f:identifies` it. Grouping and containment are different claims,
  and mermaid nesting only expresses the second.
- Fallout: template membership has to be provenance in the editor's own
  namespace, and rendering an instance as one collapsible box then needs a second
  parentage source. That widens ADR 0016's Context but not its invariant —
  `separateSiblings.js` is geometry over boxes and never asks what made the
  parent. `parentOf` being a first-parent-wins tree is what forces containment to
  be given priority explicitly.
- Also wrong in the draft: `bond0` and `host` were both top-level subgraphs, so
  "the outermost subgraph is the root" does not decide. The root has to be
  declared in frontmatter.
- The corrected example still needed care: a node's parent is the subgraph that
  *first mentions* it (`!node.parent` guards in `parser/index.js`). Declaring
  `eth0` at top level and then listing it inside `bond0` leaves it parentless, so
  `bond0` would contain nothing.
- On parameters, RDF's monotonicity does the design work. Adding to a generated
  member is free because generated ids are ordinary document ids; replacing needs
  a defaults rule for single-valued predicates; removing needs negation, so it is
  refused and variants become separate templates. Counted repetition is refused
  for a concrete reason — it invents ids nobody wrote, so nothing can override
  them afterwards.
- Value binding, if it ever lands, needs no new syntax: `parseAttrs` already
  accepts arbitrary `key: value` pairs in a mermaid `@{…}` block on every shape
  form, and the emitter drops them. Unverified: whether mermaid's renderer
  tolerates unknown keys there.
- **A testcase section cannot span two mermaid blocks.**
  `parseTestcaseSections` in `rdf-emit.test.js` hardcodes `testcases.md` and
  takes only the *first* fence per `## section`. `merge-diagrams-with-same-id`
  already documents a second block that its snapshot does not assert, so it
  looked like multi-block cases were supported. Any case needing two diagrams —
  a template plus its instantiation — needs the harness to drive `parseDocument`
  over the file instead.
- Adding a prefix to the corpus is checkable before writing any code: no
  `T:`-shaped class token exists in the 13 example files, and `kind:`/`root:` are
  unused frontmatter keys (`config:` is the precedent for a key the parser
  ignores). So the 14 existing snapshots must stay byte-identical when templates
  land — that is the regression test.
- **Bookkeeping written into a diagram's own graph is visible.** In
  `buildGraphModel`, a quad that is not `rdf:type` and is not intercepted by
  `CONTAINMENT_PREDICATES` becomes a drawn edge and an entry in the Links
  filter. So the template-membership predicate has to be registered as
  containment is, or an instance draws one link per member — precisely the
  drawing the collapsible box was meant to replace. The set's own comment says
  it: *structure, so they are never also drawn as an edge.*
- The mirror of that: a literal that is not `rdfs:label` is invisible to the
  view. It killed a `ds:memberId` triple that had been specified per member per
  instance — nothing read it, and the member name is recoverable from
  `ds:partOf` plus the generated local name. Derivable provenance is not
  provenance worth storing; the question to ask of any bookkeeping triple is
  which consumer reads it.

Last 24h · these are independent characteristics of your usage, not a breakdown
68% of your usage came from subagent-heavy sessions
Each subagent runs its own requests. Be deliberate about spawning them — and consider configuring a cheaper model for simpler subagents.
31% of your usage was at >150k context
Longer sessions are more expensive even when cached. /compact mid-task, /clear when switching to new tasks.
13% of your usage came from subagents under "Explore"
If this runs frequently, consider configuring its subagents with a cheaper model or tightening their prompts.
Skills
% of usage
/d3fend-expert
3%
/markdown-editor
3%
Subagents
% of usage
Explore
13%
Plan
4%
d3fend-expert

## 2026-09-08 — the header states the D3FEND release, and one variable drives it

Task: show the D3FEND ontology version on the home page, taken from a
configuration variable, with a release bump rebuilding everything.

- **The version and the data have to come from the same step or they drift.**
  First cut generated `d3fend-version.json` *from* the committed ontology, which
  reads whatever happens to be on disk. Inverting it — `D3FEND_VERSION` in
  `rebuild-data.sh`, gate the ontology against it, then generate — makes the
  header a claim the build has already checked.
- The gate runs before any generator. A mismatch then costs a message; after the
  generators it would cost a `src/data/` built from one release with a header
  advertising another.
- Reading `owl:versionInfo` does not need rdflib. It is in the first stanza, so a
  60-line window plus a regex replaces a 20-second parse of 130k triples — and
  the window is what keeps the match off the *declaration* of `owl:versionInfo`
  further down the document.
- `regulation.ttl` had its graph-metadata stanza *above* the `@prefix` block, so
  the whole file was invalid turtle — `dct:` unbound. It broke
  `build-legal-metadata.py` and, silently, the `K:regulation` Source in the app.
  A hand-authored file is the one place nothing checks the syntax; parse it once
  after editing.
- **The position of the ontology stanza is not a contract.** 1.4.0 puts
  `<…/d3fend.owl> a owl:Ontology` right after the `@prefix` block; 1.6.0 sorts it
  in among the terms, ~22 000 lines down. A 60-line window read the version as
  absent, the gate failed, and the run exited before a single generator — the
  reported symptom was "the data files are not rebuilt". The reader now scans for
  the stanza and stops at it, which is still ~0.07 s.
- Narrowing the *text* the regex sees, rather than the number of lines read, is
  what keeps `owl:versionInfo` from matching its own annotation-property
  declaration.
- Normalizing a prefix cannot be textual. `ex:Term` in a triple and the same
  string inside one of D3FEND's definition literals are indistinguishable to a
  regex, and those definitions quote CURIEs — so the `d3f:` rebinding reparses
  and reserializes, and only when upstream renames the prefix.
- A missing or stale ontology is the one input the script can produce itself, so
  it does not belong in the required-inputs check that exits first.

## 2026-09-08 — implementing templates: expansion as a source rewrite

Task: implement ADR 0031 — architecture templates — in the parser, emitter and view.

- **Rewriting the source beats transforming the AST.** Expansion replaces the
  line that declares an instance with the mermaid it stands for, then re-parses.
  Everything downstream — emitter, `taggedIds`, containment, the preview, the
  symbol index — needed no template awareness at all. The AST→AST alternative
  would have left the preview showing one box and the graph showing many nodes.
- The expanded ast has to *replace* the original, warnings included. Re-parsing
  reproduces every complaint the original made except those about the replaced
  lines — and drops the one that was wrong: a block whose only node is a template
  reference has no class annotations until it is expanded.
- `:::styleClass` was free syntax: mermaid renders it and `tokenizeLine` already
  stripped it, so `:::shared` cost one extra return value. `%-` would have cost a
  parser change *and* broken the preview, since mermaid rejects `%` in an id.
- **Two provenance predicates, two different view problems.** `ds:partOf` is
  stated from the member's side, so it is inverse containment — feeding it to
  `CONTAINMENT_PREDICATES` unchanged would have made the member the parent.
  `ds:instantiates` points at a *block*, so drawing it would put a template in
  the graph as a resource; it needed skipping outright.
- Membership is applied in a second pass, after the quad loop. "First parent
  wins" plus "containment beats membership" is only true if containment is seen
  first, and `store.getQuads()` order is not a contract.
- `serialize.js` already solved the prefix-churn problem: `usedPrefixes` narrows
  PREFIXES to those actually in the quads, so adding `T:` and `ds:` left all 14
  existing snapshots byte-identical. Worth checking before assuming a new prefix
  is expensive.
- Writing the expected expansion into the fixture as a third mermaid block only
  works if the test treats it as *output*: feed the first two blocks, compare
  quads with the third. Tracing that by hand found the block was wrong — the
  rewrite keeps the whole block, so the call-site edge belongs in it.

## 2026-09-08 — folding reset the view, and the fix was one node, not the viewport

Folding re-runs the layout, and `runLayout`'s `layoutstop` ended in
`cy.fit(undefined, 20)`, so every fold threw away the reader's zoom and sent them
back to the whole drawing — worse the deeper they were zoomed in.

- Restoring the old `pan`/`zoom` verbatim is the obvious fix and the wrong one: a
  re-layout moves every node, so the same viewport frames a different part of the
  graph. What survives a re-layout is a *node*, not a rectangle. Anchor on the one
  node the user is demonstrably looking at — the one they just folded — and the
  drawing changes around a fixed point.
- The arithmetic is cytoscape's own `rendered = position * zoom + pan`, inverted
  for pan. Pulling it into `viz/viewAnchor.js` made the only interesting part
  testable without building a `cy` instance, which no test here does.
- Capture *before* `cy.elements().remove()` and restore at the very end of
  `layoutstop`: `rotateBy`, `applyContainerBands` and `separateOverlaps` all move
  nodes after the layout settles, so anchoring any earlier lands off by whatever
  they nudged.
- `cy.viewport({zoom, pan})` in one call, not `cy.zoom()` then `cy.pan()` — two
  calls draw two frames and the zoom alone first moves the view about the wrong
  point.
- The anchor has to survive the render, and it need not: folding an ancestor
  swallows the node. Keeping `cy.fit` as the fallback means the feature degrades
  to today's behaviour instead of leaving the viewport on empty space.
- Plumbing it as a one-shot `pendingViewAnchor` in `main.js`, consumed and cleared
  by the next `renderGraph()`, kept `update()`'s default (fit) intact for every
  other caller. The context menu and the `f` shortcut both go through one
  `foldNode()`, because a shortcut that refits when the menu does not reads as a
  bug in the shortcut.

## 2026-09-09 — a connection URL fronting a cluster has no single D3FEND class

- D3FEND lacks `d3f:Cluster`, `d3f:Endpoint`, `d3f:ConnectionString`, `d3f:URI`,
  `d3f:LoadBalancer`, `d3f:VirtualIP` and any `resolves-to` property. A MySQL URL
  hiding an InnoDB cluster has to be split: `d3f:URL` (its definition names JDBC
  explicitly) → `d3f:DomainName` → several `d3f:DatabaseServer`.
- The one-to-many is already legal: every naming restriction uses
  `owl:someValuesFrom` (`DomainName identifies IPAddress`, `Hostname identifies Host`, `URL addresses Resource`) and nothing declares cardinality or
  `owl:FunctionalProperty`, so one name identifying many addresses needs no new
  axiom.
- For the cluster as one object: `d3f:HostGroup` is the only class with a
  `contains someValuesFrom d3f:Host` restriction, but it is typed as access-control
  configuration (`AccessControlGroup` → `ConfigurationResource`). `d3f:DigitalSystem`
  fits semantically and carries no restrictions at all, so it needs a local
  `contains` axiom.
- D3FEND does not use `rdfs:domain`/`rdfs:range` for artifact relations — 8 of 261
  properties have a domain, all on `Artifact`/`Event`/`Weakness`/`Process`. Asking
  "which properties have domain X" always returns nothing; read the
  `owl:Restriction` blank nodes under `rdfs:subClassOf` instead, and query which
  classes name X as a restriction filler to get the inbound relations.
- `d3f:maps` is not a name→address mapping: "x discovers and records how y is
  arranged and interconnected", i.e. a discovery act. `d3f:has-member`/`member-of`
  sit under `d3f:d3fend-kb-object-property` (KB bookkeeping), not
  `d3f:associated-with`, and carry no definition — not usable for domain modelling.

## 2026-09-09 — the cloud database is the class that has no host

- `d3f:Cloud-basedDatabaseApplication` ("underlying infrastructure is managed by a
  third-party cloud provider", synonym "Serverless Database Application") is the
  URL-only counterpart to `d3f:DatabaseServer`: it sits under
  `DatabaseServiceApplication` → `Application` → `Software`, entirely outside the
  `Server` → `Host` → `ComputerNetworkNode` branch, and its single restriction is
  `d3f:provider some d3f:CloudServiceProvider`. No host, hostname or IP relation
  exists on it — that absence is the modelling statement.
- `d3f:provider` is the only bridge from a `d3f:DigitalArtifact` to the `d3f:Agent`
  subtree (`CloudServiceProvider` → `ServiceProvider` → `Provider` →
  `Organization` → `Non-PersonEntity` → `Agent`), and
  `Cloud-basedDatabaseApplication` is the only artifact class using it. Code that
  walks artifact edges (`app/src/rdf/artifactFlow.js`) cannot assume every edge
  stays inside `DigitalArtifact`.
- Link a URL to it with `d3f:identifies` (inherited from `d3f:Identifier`,
  `identifies some d3f:Artifact`), not `d3f:addresses` (`d3f:URL addresses some d3f:Resource`, and an Application is not a `d3f:Resource`).
- Cloud classes have no defensive coverage: `Cloud-basedDatabaseApplication` is in
  0 rows of `d3fend-full-mappings.csv` and 0 technique restrictions, and no
  `def_artifact` value anywhere contains "Cloud" — the 434 cloud rows are all
  offensive. Coverage lives on `d3f:URL` (28 def rows: URL Analysis, URL Reputation
  Analysis, Homoglyph Detection), `d3f:NetworkResource` (54), and `d3f:Credential`.
  Type the node for what it is, but keep `d3f:URL`/`d3f:Credential` for the
  countermeasures.
- Dead branches to avoid: `d3f:RemoteResource` and `d3f:WebResource` have zero
  restrictions, zero fillers and zero mapping rows. `d3f:CloudService`,
  `d3f:CloudPlatform`, `d3f:CloudInstance`, `d3f:Tenant` do not exist; the complete
  cloud artifact set is six classes (`Cloud-basedDatabaseApplication`,
  `CloudConfiguration`, `CloudInstanceMetadata`, `CloudStorage`, `CloudUserAccount`,
  `CloudServiceSensor`).

## 2026-09-09 — grouping by relation: four reasons a box is the wrong element

ADR 0032 asked whether N same-predicate edges from one subject should become a
container node. Rejected. The four grounds are independent, which is what made
the answer clear rather than a judgement call:

- **A compound node is a tree.** `parentOf` in `app/src/rdf/graphModel.js` keeps
  the first parent — "cytoscape compound nodes are a tree, not a DAG". A target
  set is not a tree: two subjects pointing at one target want two overlapping
  boxes, and a target already inside a `d3f:contains` container has no parent
  slot. ADR 0031 settled that contest for containment, so a relation-drawn box
  would appear only where the diagram had nothing else to say.
- **Non-transitivity, measurable.** D3FEND declares five
  `owl:TransitiveProperty` object properties and four are the containment family
  (`contains`, `contained-by`, `may-contain`, `may-be-contained-by`; the fifth is
  `process-ancestor`). Boxes nest and a reader reads the nesting, so only a
  composing predicate can be drawn as one. Grep the ontology before arguing about
  this — it is a two-second check.
- **The box already means two things** (ADR 0016 containment, ADR 0031 instance
  membership), and 0031 books the ambiguity as a Con. A third meaning is not one
  more: it is one box shape per predicate the diagram uses.
- **Measure the corpus before designing.** Largest same-subject-same-predicate
  fan-out across `app/src/data/examples/` is four; the median is one. And the one
  literal instance of the ADR's own sketch (`multi-graph.md`, `CDN d3f:mediates-access-to dc-1 & dc-2`) is the case the feature would damage — the
  two targets have an edge to each other and children of their own. A feature
  whose motivating example refuses it is not motivated.

Two things worth keeping from the rejected design work:

- The viable alternative was a **fold-style stack**, not a box: one synthetic node
  standing for the N targets with *no* parent link to them. It escapes the first
  three grounds because it contests no parent slot and claims no containment, and
  it would have cost almost no new code — `node[folded]` styling, `foldedCount`,
  `derivedEdgeWidth` and ADR 0026's `standsFor` channel already exist. It died on
  the fourth ground alone. Recorded in the ADR so it need not be re-derived.
- An `&`-joined mermaid group **is** visible to the parser (the edges share an
  `arrowIndex` in `app/src/parser/edgeParser.js`) but never reaches the RDF, and
  ADR 0014 forbids the view reading anything else. Any grouping feature must
  re-derive its group structurally from the store, the way `collapseArtifactPaths`
  does. Do not reach for `arrowIndex`.

## 2026-09-09 — a platform is fault tolerant only if the graph says two things are one thing

`multi-graph.md` draws two datacenters, each with an "Application" inside it, and
looks redundant. The graph is not: `dc-1-app` and `dc-2-app` are unrelated
resources sharing a label. Every availability question dies there — nothing can
count the sites a service runs in, because nothing says which nodes are the same
service. Settled in ADR 0034 with `16-application-site-coverage.rq`,
`17-dependency-locality.rq` and `multi-site-platform.md`.

- **Check the ontology before designing the model.** D3FEND 1.6.0 has *no* term
  for redundancy, replica, failover, availability zone, datacenter, cluster or
  fault tolerance. Every `Cluster*` class is machine-learning clustering.
  `d3f:depends-on` exists and is stated once in the whole file, on
  `d3f:PublicKey`. So the property cannot be asserted; it has to be derived.
- **`Host`, `Application` and `Process` are not three peers.** The stated shape is
  `Host ⊑ ∃contains Application`, `Server ⊑ ∃runs ServiceApplication`,
  `ApplicationProcess ⊑ ∃runs Application`. Nothing relates `Host` to `Process` at
  all, so containment has to supply that edge. `d3f:Service` does not exist.
- **`d3f:DatabaseService` is a process, not an application.** Its parent is
  `d3f:ServiceApplicationProcess`. The corpus uses it where it means the product,
  which reads as a typo of intent that no validation query catches.
- **A host has no location.** `d3f:PhysicalLocation` is a stub under
  `D3FENDCore`; `d3f:has-location`'s one restriction is on `d3f:PhysicalArtifact`,
  and `d3f:Host` is a `DigitalArtifact`. The ontology's own bridge is three hops
  through a `ComputerEnclosure`. Nesting the host in a location box says it in one.
- **The correlation point is a shared node, not a predicate.** N processes with
  `d3f:runs` into one `d3f:ServiceApplication` is the identity statement, and it
  is a fan-in the drawing already handles — no new vocabulary, no new box shape,
  and ADR 0032 stays intact because `d3f:runs` never becomes a container.
- **Two site-availability questions, not one.** "How many sites does this service
  run in" reports a service in both sites as healthy while its only database sits
  in one of them. The check that finds that walks the other way: per site, per
  service running there, what does it need that the site has not got.
- **`d3f:contains+`, always with the `+`.** `owl:TransitiveProperty` is declared
  and materialised by nothing — the worker flattens `owl:Restriction`s and does
  not reason. A missing `+` reports every application as deployed nowhere.
- **`K:d3fend` holds class-level `d3f:contains`,** from that same restriction
  flattening. A containment path that escapes the document-graph filter walks the
  ontology instead of the platform, so the K: exclusion is load-bearing here and
  the test fixture now carries those triples on purpose.
- **`OPTIONAL` around the whole deployment pattern** is what makes an application
  nothing runs report `sites = 0` rather than vanishing. An inner join drops
  exactly the likeliest single point of failure.
- **No node on this machine,** so the vitest suite could not run. Validated both
  `.rq` files with `pyoxigraph` against hand-written quads matching the emitter's
  output — 11 assertions, all passing. That checks the SPARQL, not the emitter;
  `app/test/platform-topology.test.js` is what closes the gap and is unrun.

## 2026-09-10 — an ontology bump moves the numbers a test asserts

`relationsFor('WebServerApplication')` returned 5 outgoing rows against an
assertion of 4. Nothing in the closure layer changed: D3FEND 1.6 (commit
28c79de) states `d3f:manages d3f:EventLog` on `d3f:Application`, which every
application below it now inherits.

- **A count asserted from the projection is a fact about the ontology version,**
  not about the code. Every such number moved: 3655 → 3688 classes, 2160 → 2188
  with no relation row of their own, 504 → 514 with more than one parent, and the
  closure 3154 → 3162 rows expanding to 31008. They are quoted in three places —
  the test, the module docstring, and ADR 0030's DONTREADME — and all three had
  to follow.
- **Read the new row before touching the assertion.** The added predicate was
  legitimate inheritance, so the fix was the number. Had the extra row been a
  duplicate, the same failure would have pointed at the dedupe key instead.
- **The ontology-derived figures stayed 1.5** (restriction and property counts,
  the 4319 candidates) because they come from the TTL, not the projection, and
  re-measuring them was not part of this. ADR 0030 now says which half is which
  rather than implying one measurement.
- **`vitest` runs in the container,** `docker exec d3sign-dev-1 sh -c 'cd /code/app && npx vitest run'` — no node on the host. 15 unrelated failures on this branch
  are the in-progress topology and graph-style work, not this change.

## 2026-09-10 — the rotate shortcut was a binding, not a feature

`R` / `Shift+R` on the graph pane turned out to be three lines in
`GRAPH_SHORTCUTS`: `graphPane.rotate(±1)` already existed behind the header
buttons, with the accumulated `rotationSteps`, the re-application at
`layoutstop` and the overlap pass all in place.

- **Read the README before the code.** It already said "two 90° rotate
  buttons", which turned "implement rotation" into "bind a key".
- **`r` breaks the shape of the table it joins.** Every other bare key acts on
  the selection and is taught by the context menu's hint. A view transform has
  no element menu to live in, so its discovery moved to the buttons' `title`
  and the doc comment and ADR 0013 had to stop claiming the table is uniform.
- **The direction rides on the modifier.** The dispatcher looks up
  `event.key.toLowerCase()`, so `Shift+R` cannot be a second entry — the
  handler had to start receiving the event.
- **A key is cheaper to press than a button, so its costs are felt more.**
  `rotate()` ends with `cy.fit`, discarding pan and zoom, and four turns are
  not the identity because the separation pass nudges nodes each time. Both are
  now cons in ADR 0013, and `event.repeat` is declined.

## 2026-09-10 — five stale graph-style assertions, three redesigns behind them

`test/graph-style.test.js` failed on five assertions and none of them was a
bug: each named a property the source had deliberately stopped setting.

- **Two numbers where the test still knew one.** The container's cytoscape
  `padding` used to *be* the label band; cf43396 split it, because `padding` is
  one scalar drawn on all four sides and a three-line label's worth of it below
  the children is waste. The band is node height now — a per-container
  `min-height` bypass written by `graphPane.js`, biased `100%` to the top by the
  sheet. So `padding === containerLabelBand` became `padding === containerSideGutter`, and the three-line-label check measures against the band
  rather than the padding.
- **What the stylesheet can still be held to** once a value moves to a bypass:
  the bias pair, and that `min-height` is *absent* from the sheet. Asserting the
  band's size there would just re-freeze what the split un-froze.
- **`data(label)` cannot survive a label preference.** `labelDetail` composes the
  drawn text from the data, so the mapper is a function and the assertion had to
  resolve it. The test's `element()` stub only answered keyed `data(k)` calls;
  the label mappers call bare `data()`, so the stub grew the no-key case.
- **`triangle` at the source end is now an effect, not a direction.** ADR 0033
  spends arrow shape on what a link does to each end, so a two-way link draws
  the base `vee` at both. The ordering that lets an effect override it was
  asserted by a code comment only — it is a test now.
- **A test that fails because the design moved says so in its comment.** All
  five now name the mechanism they are pinning, so the next redesign fails
  against a stated intent rather than a number.

## 2026-09-12 — the guard the codebase had never needed

Deriving a compound parent from a location edge made a true
parent cycle reachable for the first time: `:a` containing `:rm`
and also naming it would parent each to the other. Every walk
nearby *looks* guarded and none of them helps.

- **`visibleParentOf`'s `seen` set guards hops over hidden
  parents, not the parenting itself.** With both nodes visible it
  returns on the first hop and the set is never consulted.
- **`separateSiblings` fails silently, not loudly.**
  `siblingLevels` walks from `cy.nodes().orphans()`, and a cycle
  has no orphan — so the whole sibling-separation pass stops
  running and nothing says so.
- **Existing guards are not evidence of safety.** The
  self-containment check and "first parent wins" made cycles
  unreachable, so no code downstream was ever written to survive
  one. Adding a second source of parenting removed that
  guarantee, and the audit had to be of what *depends* on the
  invariant, not of what enforces it.

## 2026-09-12 — a migration chain needs the raw payload at every hop

`showLocation` → `locationPins` → `locationView` is two renames,
and both hops have to read `prefs`, not the object already
spread over the defaults. The defaults fill the new key in, so
the merged object can never distinguish a saved value from an
absent one — the same trap as the first rename, one layer
deeper.

- **Write the migration test as a table over both old keys.**
  Four rows caught more than four assertions would have, because
  the shape makes the missing hop obvious.
- **Delete the old keys after migrating**, or `loadPrefs()`
  returns a payload carrying three spellings of one preference.

## 2026-09-11 — node lives in the docker `dev` service

Three rounds of work shipped unverified because `node` and `npx` are not on the
host PATH and I read that as "no runtime available". The project runs on
`docker-compose.yaml`'s `dev` service, which was already up the whole time.

- **The command is**
  `docker compose exec -T -w /code/app dev npx vitest run`. `-T` because there is
  no TTY, `-w /code/app` because the repo mounts at `/code` and vitest's root is
  `app/`.
- **Check `docker compose ps` before concluding a toolchain is missing.** A
  devcontainer or compose service is the normal answer in a repo that has
  `.devcontainer/` and a compose file, and both were in the listing I had read.
- **The cost was not the delay, it was the false report.** Saying "you'll need to
  run these" three times in a row, when the first baseline would have shown 20
  red tests, put unverified work in front of the user as though the only thing
  missing were a convenience.

## 2026-09-11 — merged defaults cannot tell a saved value from an absent one

The rename migration `showLocation` → `locationPins` read the key off the object
that had already been spread over `DEFAULT_PREFS`. The default filled it in, so
`merged.locationPins === undefined` was never true and the old value was never
carried across. The test caught it; the reasoning would not have.

- **Migrate off the raw payload, not off the merged object.** `{...DEFAULT, ...saved}`
  destroys exactly the distinction a migration is asking about.
- `normalizePrefs` already had the argument in scope — `prefs?.showLocation` — so
  the fix was smaller than the bug.

## 2026-09-11 — a colour constant nothing could ever look up

Adding `CATEGORY_COLORS.Location` did not colour a single node. `coreCategoryOf`
only ever returns a branch from `CORE_CATEGORY_PRIORITY`, a five-entry list that
did not include `PhysicalLocation`, so the key was unreachable and the node kept
`DEFAULT_CATEGORY_COLOR`. The edge rule worked only because it read the constant
directly.

- **A lookup table is half a feature; the thing that produces the key is the
  other half.** Grep for what writes the key, not just for what reads it.
- **`nodeKind.js` states the invariant that catches this** — a node's bucket
  agrees with its category, both decided in one function. Colouring a category
  with no bucket breaks it silently, which is why the Nodes chip had to come
  with the colour rather than after it.
- **The category name is not the branch name.** D3FEND's branch is
  `PhysicalLocation`; DPV's family folds onto the same idea and a
  `dpv:CloudLocation` is not physical, so the category is `Location` and
  `CATEGORY_BY_D3FEND_BRANCH` does the one remap.

## 2026-09-11 — `prefix:local-name` does not say class or property

`CLASS_TOKEN_RE` matches `d3f:has-location` exactly as it matches
`d3f:PhysicalLocation`, so a subgraph title naming a relation typed the box
`a d3f:has-location`. The regex cannot be fixed: the two are the same shape.

- **Ask the projection, not the spelling.** `termOf(qname)?.kind` is exact, and
  the case convention (zero uppercase properties across all vocabularies) is
  only *almost* exact — `d3f:t-SNEClustering`, `ob:gdpr-art12` and `tech:iOS`
  are lowercase classes.
- **Direction cannot be derived from a CURIE.** `d3f:has-location` is stated
  from the member, `d3f:contains` from the container, and the completions
  projection carries no domain or range. The containment family is a listed
  exception in `emit.js`; inferring it would have silently written
  `ws-1 d3f:contains dc`.
- **A testcases.md section with no snapshot proves nothing.**
  `toMatchFileSnapshot` writes the file on first run, so a new scenario is green
  whatever it emits until someone reads the `.trig`.

## 2026-09-10 — a fixture that omits the field the feature is made of

`filter-panel.test.js` asserted that a hidden link kind stays hidden, from a
payload with no `kinds` key. That is precisely the payload the loader treats as
predating the vocabulary, so the migration put the kind back. The test could
never have passed: it has been red since the initial import, and its node-kind
twin passes only because that one writes `nodeKinds`.

- **The migration's whole content is the vocabulary field.** Without `kinds`,
  "absent from `visibleKinds`" is both "the user hid it" and "it did not exist
  yet", and the loader has to pick one. It picks visible, because a lost edge is
  invisible and a restored one is a click.
- **Fixture-shaped bug, not a code bug.** `saveFilterState` has written `kinds`
  since that commit, so no payload in the wild looks like the fixture except the
  legacy ones the fallback is for. The fix was the fixture, plus a second test
  that states the fallback's cost instead of leaving it to be rediscovered.
- **The comment said "equivalent", and that is why the fixture looked right.**
  Both `filterPanel.js` and ADR 0007 claimed a pre-`kinds` payload falls back to
  something equivalent; it is equivalent only when the payload hid nothing. A
  wrong sentence in a doc comment survives as long as the test agreeing with it.

## 2026-09-11 — "files were modified by this hook" from a hook that writes nothing

The pre-push trufflehog hook reported `Failed - files were modified by this hook` while its own output said `verified_secrets: 0, unverified_secrets: 0`.
The container only reads: it clones `file:///workdir` into its own tmpdir.

- **pre-commit attributes any working-tree change to the hook that was running.**
  It diffs the tree before and after each hook; it cannot tell the hook's writes
  from anyone else's. A concurrent write - an editor saving, an agent editing,
  a second pre-commit run - lands inside the ~6s docker scan and is blamed on it.
- **The stash window makes concurrent inspection lie.** While the hook runs, the
  unstaged changes live in `~/.cache/pre-commit/patch<ts>-<pid>`, so `git status`
  reads clean, then reads dirty again after the restore. Two `git status` calls
  minutes apart disagreeing is the stash, not lost work; the identical mtimes on
  every restored file are the tell.
- **Re-running the hook alone passed.** Nothing in `.pre-commit-config.yaml`
  needed changing - the fix is to push with no other writer touching the tree.

## 2026-09-12 — a floating banner is a control the reader cannot reach past

`#lint-message` hung off the header's bottom-right at `z-index: 5`, landing on
the right column's tab bar and pane header tools. It was floated on purpose: in
the flow it grew the header, and the shell grid gives the columns what the
header leaves, so a warning coming and going between keystrokes resized every
pane.

- **Both constraints hold at once if the report is two halves.** A one-line chip
  in the flow, the height of the buttons beside it, never changes the header's
  height and never covers anything; the panel it opens is out of the flow and
  only up while asked for.
- **The popover was already written.** `viz/filterChip.js` uses `popover="auto"`
  for exactly this - the top layer escapes pane clipping, light-dismiss gives
  click-outside and Escape free. Its `place()` became the exported
  `placeUnderAnchor(anchor, popover)`, so the lint panel is placed by the same
  code rather than a second hand-rolled dismiss convention.
- **A count is what a narrow chip can say honestly.** `showLint` now takes a
  string or a list; the joined-with-spaces string at the parser call site could
  only be truncated, a list can be `2 issues` with one `<p>` each in the panel.
- **A picker that always shows a file name reads as a label.** `#example-select`
  had no placeholder, so it claimed an example was open even when the editor had
  restored a browser-local document. `'Pick an example…'` prepended and selected,
  the way `#query-select` already does it.
- **Tests run in the container:** `docker exec d3sign-dev-1 sh -c 'cd /code/app && npx vitest run'`. 16 failures on this branch, all in graph/layout/query
  areas nobody touched here.

## 2026-09-13 — link shape as a preference, and where `breadthfirst` starts

Task: expose cytoscape's `curve-style` in the View popover, after a question about
the `breadthfirst` layout's root selection.

- **`breadthfirst` has no single start node.** With `roots` unset and
  `directed: true` (`viz/layouts.js`), cytoscape uses `nodes.roots()` — *every*
  childless node with in-degree 0. Depth is the hop count from the nearest of them,
  first visit wins, and anything BFS never reaches (isolated nodes, a component that
  is one cycle) is `unshift`ed as a **new row above depth 0**. So a fully cyclic
  diagram renders as one flat top row, which looks like a bug and is not.
- **The direction it reads is the direction *drawn*.** `toCytoscape.js` applies the
  per-predicate swap and `orientByFlow` before the layout sees an element, so those
  two view options change the root set.
- **`curve-style` is a restyle, not a relayout.** The routing moves, the node boxes
  do not, so `edgeStyle` stays out of `LAYOUT_AFFECTING` in `viz/graphPane.js` and
  out of the `rebuild` condition in `main.js` — a relayout would discard dragged
  positions for nothing.
- **`taxi-direction` must stay `auto`.** Pinning it to `horizontal` to match
  `elk.direction: 'RIGHT'` is right until the rotate buttons turn the drawing, and
  rotation moves positions without re-running the layout.
- **Three of cytoscape's curve styles are unusable here.** `haystack` ignores arrow
  shapes, which ADR 0033 spends on the reading/writing terminators; `unbundled-bezier`
  and `straight-triangle` need per-edge control points, and this stylesheet styles
  edges by selector only.

## 2026-09-13 — a box as a set, and the untagged edge endpoint

Task: assess `subgraph-as-relationships` (an edge naming a subgraph distributes
over its members) and add two testcases pinning it down.

- **The edge loop in `emit.js` does not apply the untagged rule the containment
  loop applies.** Children are filtered by `isTagged` before `d3f:contains` is
  written, but an edge is emitted whatever its endpoints are — so
  `vip -->|d3f:connects| fe` on an untagged box already emits `G:vip d3f:connects G:fe`, a triple about an id ADR 0003 says is not a resource. Same rule, two
  behaviors.
- **Distribution is only coherent if the *untagged* box is the one that does it.**
  A tagged box is a resource, so the link names it; an untagged box is a set
  expression, which keeps "untagged is not a resource" intact. But tagged-ness is
  document-global, so a class written in another block silently turns N triples
  into 1 — the sharpest cost of the feature.
- **It is sugar for the `&`-group.** `a -->|p| x & y & z` already yields exactly
  the distributed quads and the group never reaches the RDF (ADR 0032), so nothing
  downstream — `graphModel.js`, `toCytoscape.js`, the panels — learns anything new.
  That framing is what keeps it from being a third meaning for a box, which ADR
  0032 refused by name.
- **The member set is not `effectiveParent`.** That walk climbs *past* an untagged
  box looking for a tagged one; the member walk must stop at the named box whether
  or not it is tagged. Same transparency rule, rooted differently.
- **The per-block fallback of `emitQuads` is now lossy, and the tests were using
  it.** `taggedIds` was optional and three suites omitted it, which was harmless
  while an untagged endpoint still got its triple. With the new rule it silently
  dropped `m1-web d3f:runs checkout` in multi-site-platform.md, whose third block
  wires ids the first block types. Hence `collectTaggedIds(diagrams)` exported from
  `emit.js`: main.js and the topology test now build the set the same way.
- **The one corpus casualty is `u((User))`.** D3FEND has no class for a human actor
  (`UserAccount` is the nearest), so the example draws the user untyped and
  `u -->|d3f:uses| checkout` is now dropped with a warning.
- **Adding a `## section` to testcases.md does not assert the `trig` block.**
  `rdf-emit.test.js` snapshots the emitter's actual output, so a section added
  before the behavior exists records today's wrong output and passes green. Land
  the section with the implementation, or read the generated `.trig` by hand.
