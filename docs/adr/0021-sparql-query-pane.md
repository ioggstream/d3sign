# 21. The SPARQL pane, and results that reach the graph

Date: 2026-08-07

## Status

Accepted

## Context

[ADR 0020](0020-sparql-query-engine.md) makes the
document and the D3FEND ontology queryable together.
This one is about the surface: where the query is
written, how results are shown, and what a result is
good for once it exists.

Two things shaped it. First, most users will not
hand-write SPARQL over D3FEND — "run specific queries
on artifacts" is the goal, and hand-written SPARQL is
the fallback, not the feature. Second, a result that
is only a table is a dead end: the app already draws
RDF, so an answer should be able to become part of the
drawing.

## Decision

- [x] A **fourth tab** in the views column,
  `Alt+Q`. The results table wants width, and that
  column is the `2fr` track which grows further when
  the TriG column is folded — the default
  ([ADR 0009](0009-direct-rdf-import.md)). A fourth
  grid column would break that ADR's 1200 px budget; a
  modal could not stay open while the graph is
  inspected.
- [x] Inside the pane, **editor over results**, split
  by a draggable row gutter — `makeResizableGutter`
  already took `axis: 'row'`. Each half owns its
  overflow, so a 500-row table cannot push the editor
  off the top.
- [x] **Typing runs nothing.** `createSparqlPane` is a
  third factory over `createTextEditor` with no
  debounce and no `onChange`; `onRun` is the whole
  contract, bound to `Ctrl+Enter` and the Run button.
  Half a query matches everything, and running one
  costs a round-trip over ~130k triples.
- [x] That binding goes in `extensions`, **not**
  `keyBindings`: extensions precede the shared keymap
  and earlier wins, so the pane takes `Ctrl+Enter`
  without reordering the array the mermaid pane's
  `completionKeymap` sits in. Reordering it globally
  would have changed completion-key precedence in the
  mermaid editor.
- [x] The pane keeps the **d3f: completions** — the
  class names are the same ones the mermaid editor
  completes and exactly what is hard to type from
  memory. Not the node completions, which read the
  mermaid document symbols and say nothing about a
  query.
- [x] **No syntax highlighting.** There is no Lezer
  grammar, `StreamLanguage` or `HighlightStyle`
  anywhere in this codebase; a keyword highlighter can
  later follow the hand-rolled
  StateField+ViewPlugin+Decoration pattern of
  `knownNodes.js`.
- [x] **Prefixes are injected**, so nobody types
  declarations. SPARQL 1.1 lets a later declaration of
  the same label override an earlier one, so a user
  who declares `d3f:` themselves still wins. The cost
  is that engine error lines count from the top of the
  *sent* text, so `adjustErrorPosition` subtracts the
  preamble length and clamps into the visible text —
  pointing at a line the user cannot see is worse than
  pointing at none.
- [x] **A canned library**, `app/src/data/queries/*.rq`,
  loaded by the same eager `?raw` glob as the example
  diagrams ([ADR 0010](0010-example-diagram-selector.md))
  and picked from a `<select>` for the same reason —
  it is the established way to choose a canned text,
  and it needs no new chord. Metadata rides in leading
  `# key: value` comments, and only the *first* run of
  comment lines counts: a `# needs:` further down is a
  note about the query, not a declaration.
- [x] A query about one node uses the variable
  `?this`, bound by appending a trailing `VALUES`
  clause. SPARQL 1.1 puts an optional `ValuesClause` at
  the end of every query form, so appending is
  grammatically safe for all of them and needs no
  parsing — which beats substituting an IRI into text
  and hoping it was not inside a string.
- [x] **`q` on the selection**, printed on the node
  menu as `Query this node`. It selects the node first,
  because a right-click does not select in cytoscape,
  so the menu path would otherwise bind `?this` to
  whatever was selected before.
- [x] Results are a **pure `resultTable(result)` plus
  a renderer**, the `edgePanelSummary` /
  `renderEdgePanel` split. SELECT, ASK and
  CONSTRUCT all come out as one `{columns, rows}`
  shape, so the renderer has one job — a boolean is a
  one-cell table, quads are four columns.
- [x] A cell whose IRI **the graph is currently
  drawing** gets a reveal button. Only then: the model
  and the drawing are not the same set, and offering to
  jump to a filtered-out or folded-away node would
  promise something that does not happen. It says so
  when it fails anyway.
- [x] A **CONSTRUCT result can be added as a named
  graph**, `urn:d3fend-graph:query:<slug>`. It then
  appears in the Graphs chip, in the TriG pane and in
  the drawing at once, with no new plumbing, because
  the graph view is built from RDF alone
  ([ADR 0014](0014-graph-view-from-rdf-only.md)). This
  is the enrichment path the README promises. Capped
  at 2000 triples, and refused outright for a
  truncated result — adding one would draw a lie.
- [x] Results **copy as TSV**, from a button above the
  table. A tab-separated paste becomes real cells in
  Excel, Sheets and LibreOffice, and needs no quoting
  rules. The text copied is the text shown: short
  CURIEs, quoted literals, and only the rows left by
  `ROW_CAP`. Tabs and newlines inside a literal become
  spaces, because a paste is a grid and a literal must
  not break it.
- [x] Status and errors go to a **pane-local status
  line**, not the global `#lint-message`, which belongs
  to the mermaid and TriG parses.

## Consequences

Pros:

- The questions that motivated
  [ADR 0020](0020-sparql-query-engine.md) are one
  dropdown pick away, so the feature is usable without
  knowing D3FEND's predicate vocabulary.
- A query answer is not a dead end: reveal a row in the
  drawing, or turn a CONSTRUCT into part of it.
- Adding a query is adding a file.
- The pure/renderer split keeps the caps, the CURIE
  shortening and the error offsets under test in a node
  environment with no DOM.

Cons:

- The chord budget grows by two, `Alt+Q` and `Alt+K`,
  and `q` joins the unmodified graph keys.
- `CHIP_SHORTCUTS` entries now carry their own
  `isActive` guard instead of sharing one graph-tab
  check, because Sources lives in a different header.
- No SPARQL syntax highlighting or error underlining;
  errors are a line number on the status line.
- A hand-written query gets no `needs:` metadata, so
  which knowledge bases it wants is inferred from the
  `K:<id>` names in its text.
- Copying a capped result copies the first 500 rows,
  not the whole answer. The warning above the table
  says so, but the clipboard cannot.
- SPARQL UPDATE is not offered. The TriG pane is the
  authoring surface, and a second write path would
  reopen ADR 0009's reconciliation problem with a
  third authority.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- Pane markup is `#query-pane` in
  [app/index.html](../../app/index.html):
  `#query-grid` holds `#query-host`, the row gutter and
  `#query-results`, with `#query-status` below.
- The pure layer is
  [app/src/query/resultModel.js](../../app/src/query/resultModel.js)
  (`resultTable`, `termCell`, `parseQueryDoc`,
  `bindSelection`, `usesThis`, `referencedSources`,
  `adjustErrorPosition`); the renderer is
  `resultsView.js`. Tests:
  `app/test/result-model.test.js`,
  `app/test/query-library.test.js`.
- `queryLibrary.js` uses `import.meta.glob`, a Vite
  transform, so it is not importable under plain
  vitest-node — `query-library.test.js` reads the `.rq`
  files off disk through the same `parseQueryDoc`.
- `ROW_CAP` is 500 (resultModel.js), `MAX_ROWS` is 5000
  (queryEngine.js), `CONSTRUCT_GRAPH_CAP` is 2000.
- `createGraphPane` gained `selectNode(iri)`, which
  returns false when the node is not drawn, and an
  `onQuery` callback feeding `nodeMenuItems`.
- `resultTsv(table)` in `resultModel.js` builds the
  copied text; the button lives in `resultsView.js` and
  needs no wiring in `main.js`.
- `copyToClipboard` and `wireCopyButton` moved out of
  `main.js` into `app/src/clipboard.js`, so the results
  toolbar and the query Copy button share them.
- The shortcuts are in `main.js`: `TAB_SHORTCUTS.KeyQ`,
  `CHIP_SHORTCUTS.KeyK`, `GRAPH_SHORTCUTS.q`. Each is
  printed on its own affordance, which is the rule
  every ADR here restates.
