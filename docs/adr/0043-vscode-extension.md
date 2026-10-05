# 43. VS Code extension

Date: 2026-10-05

## Status

Proposed.

Supersedes, inside VS Code only, [ADR 0022](0022-column-tab-groups.md) (the
workbench's editor groups replace the column layout) and
[ADR 0023](0023-browser-local-file-store.md) (workspace files replace the
browser store). The SPA keeps both.

## Context

The SPA keeps documents in `localStorage`. A diagram that belongs to a
repository has to be exported, copied over the file and committed by hand, and
the browser copy and the repository copy drift.

VS Code already has what the SPA rebuilt: files, save, git, tabs and split
groups. What it lacks is the parser, the graph and the SPARQL pane.

`main.js` cannot be reused as it is. It is one 1857-line module whose
module-level state (`graphContributions`, `visibleGraphs`, `filterState`,
`selection`, `currentModel`, `queryStoreState`) is shared by the editor, the
graph, the TriG pane, the query pane and the file store. A second host would
copy the wiring, and every new chip would then be written twice.

## Decision

- [ ] **The source editor is VS Code's markdown editor.** CodeMirror and its
  editor extensions are not carried over. Completion, hover, symbols, class swap
  and insert-measure are deferred, because the user already has completion
  providers. The one exception is parser warnings: they are published as
  diagnostics, because without the SPA's lint chip a line that emits nothing
  (`|reads|`, `<--`) would be silent.

- [ ] **Graph, SPARQL and RDF are separate tabs**, and each follows the last
  focused markdown editor. RDF is a read-only virtual document
  (`d3sign-trig:`), so ADR 0009's dirty/Regenerate reconciliation does not
  exist there.

- [ ] **`main.js` is split into three units that both hosts call.**

  - `rdf/documentModel.js` (pure, Node-safe): text → contributions.
  - `viz/mountGraphView.js` (DOM): contributions → drawing. It owns the store,
    the visibility, the filters, the preferences and the selection.
  - `query/mountQueryView.js` (DOM): the SPARQL pane.

  Each takes its host-specific behaviour as a `shell` object of callbacks.
  `main.js` keeps only the SPA's own concerns: the CodeMirror panes, the files,
  the column layout and the session buttons.

- [ ] **In VS Code the extension host owns the document model.** It parses on
  change, serves the TriG virtual document and posts contributions to the
  webviews. SPARQL runs in the host on oxigraph's Node build, behind the same
  message protocol the browser worker speaks. No wasm and no worker are loaded
  inside a webview.

- [ ] **Prompts are injected.** VS Code webviews do not implement
  `window.prompt`/`confirm`, so every prompt in the moved code goes through
  `shell.prompt`/`shell.confirm`, which return promises. The SPA passes
  `window.prompt`/`window.confirm` wrapped in `Promise.resolve`.

- [ ] **The split changes no SPA behaviour**, including the behaviour that
  looks like a bug (DONTREADME, "preserved, not fixed").

## Consequences

Pros:

- Diagrams are saved and committed where they live.
- Parser, RDF, viz and query changes reach the extension on the next build with
  no edits. A new graph chip is written once, in `mountGraphView.js`.
- `documentModel.js` is the first test of the text → contributions step that is
  independent of the DOM.

Cons:

- Two hosts to try by hand, since the suite runs in node with no jsdom.
- Every cross-tab action in VS Code is a message round trip through the host.
- Webview `localStorage` (filters, preferences, saved queries) is per webview
  origin. If it does not survive a reload, the fallback is a `shell.storage`
  injection, which is not built until it is needed.

## DONTREADME

Notes for LLM agents. This is the spec the implementation phases work from: read
it instead of re-deriving it from `main.js`. Line numbers are `main.js` at
commit `454aa35` plus the uncommitted work of 2026-10-05. Check them with
`grep -n` before moving code.

### Baseline

`docker compose exec -T -w /code/app dev npx vitest run` before any phase-0
edit: **12 files / 22 tests failing, 1261 passing.** The failures predate this
ADR and touch none of its files: `layouts`, `legal-queries`, `parser`,
`rdf-emit` (snapshots), `flow-polarity`, `neighbour-graph`, `templates`,
`platform-topology`, `knowledge-bases`, `selection-box`. Phase gate: the same 22
failures and no new ones.

### Types

```js
// A named graph of the document. Exactly what main.js keeps in graphContributions.
Contribution = { name, label, description, kind: 'diagram'|'enrichment'|'query'|'manual',
                 quads /* n3 */, edgeComments? /* [{subject,predicate,object,comment}] */ }
// The postMessage form: n3 terms do not survive JSON, so quads travel flat.
FlatContribution = { ...Contribution, quads: FlatQuad[] }   // query/flatQuads.js shape
```

Add `flatFromQuad(quad)` / `flatFromQuads(quads)` to `query/flatQuads.js`, the
inverse of `quadFromFlat`. `flattenTerm` in `queryEngine.js` already writes that
shape.

### `app/src/rdf/documentModel.js` (pure: no DOM, no localStorage, no Vite imports)

```js
createDocumentModel({ enrichmentTurtle, defaultDiagramId = 'current' }) → {
  setText(text) → { diagrams, warnings },  // main.js 839-901: parse, expandDocument, collectTaggedIds,
                                           // emitQuads per block, merge by graph name, stale sweep
                                           // over knownGraphNames, ensureEnrichment (669-680)
  contributions() → Contribution[],
  get(name) → Contribution | undefined,
  add(contribution, { sweepable = false }),// sweepable: joins knownGraphNames (CONSTRUCT, 1415);
                                           // mint passes false (comment at 368-371)
  remove(name) → boolean,                  // 804-808 minus store/visibility
  replaceFromTrig(text) → { error } | {},  // 735-756 minus lint/badge/store
  toTrig() → Promise<string>,              // 716-718
}
```

`enrichmentTurtle` is injected because `?raw` is a Vite import. The SPA passes
`wellKnownAuthFlows`, and the extension host bundles the same file through
esbuild's `?raw` plugin. Test: `app/test/document-model.test.js`, run against a
small inline diagram, not the examples (`lessons.md`, "parser tests must not
assert on the example diagrams").

### `app/src/viz/mountGraphView.js`

```js
mountGraphView(host, shell) → {
  setDocument(contributions) → { warnings },   // full rebuild after a text change: 691-698 + 912-919
  selection() → { kind, id, … } | null,
  drawnNodeIds() → Set<iri>,                   // currentModel.nodes.keys(), for query knownNodes
  selectNode(iri) → boolean,
  flashError(message),
  fitView(), resize(), closePanel(),
}

shell = {
  isActive: () => boolean,              // gate for bare keys + Alt+T/N/L/V (SPA: dock.isVisible('graph'))
  prompt: (message, value) => Promise<string|null>,
  source: {                             // SPA: editorPane.{hasSource, revealSource, hasEdgeSource,
    has(mermaidId), reveal(mermaidId),  //   revealEdgeSource, addRelation, changeNodeClass}
    hasEdge(keys), revealEdge(keys),
    addRelation(mermaidId, rel) → boolean,
    changeClass(mermaidId, oldQname, newQname) → boolean,
  },
  onAddGraph(contribution) → string | undefined,  // mint; return value appended to the panel message
                                                  // (SPA: the turtleDirty note from line 399)
  onRemoveGraph(name),
  onQueryNode(iri),                    // called after selectNode(iri), as queryNode() did at 1441
  onQueryClassPair(pair | null),       // { source, target } bare d3f local names; null = error case (1471)
  onSelectionChange(selection),
  onPrefsChange(prefs),                // SPA: applyEditorFontSize + requestMeasure on the three editors (621-626)
}
```

It renders its own markup, which moves from `index.html` 140-151 (chips host,
selection box, layout select, rotate buttons, `#cy-host`, `#node-panel`). Element
ids are unchanged, so `app.css` applies as is.

It moves from `main.js`:

- 180-240: Graphs/Nodes/Links/View chips and the prefs load;
- 263-310: selection and path focus;
- 322-348: the go-to-source helpers, now over `shell.source`;
- 350-401: mint, with `window.prompt` → `shell.prompt`;
- 403-496: panel actions, `d3fClassOfNode`, `edgeAlternatives`, swap;
- 498-534: `createGraphPane`;
- 536-553: view state (`currentModel`, `filterState`, `pendingViewAnchor`,
  `visibleGraphs`, `allPredicates`, plus the `store` from 498);
- 558-628: fold, filter change, links panel, `renderGraph`, prefs panel;
- 691-709: visibility. This becomes internal `applyVisibility()`: store sync and
  model build only. The TriG and Sources refreshes stay with the caller;
- 767-826: Graphs panel, remove, toggle-matching;
- 1089-1100: layout select and rotate;
- `CHIP_SHORTCUTS` KeyT/N/L/V (1640-1644);
- `isGraphShortcutContext`, `GRAPH_SHORTCUTS` and the Escape branch
  (1676-1787), as the view's own capture-phase `keydown` listener.

`setDocument` also clears from the store every graph that was drawn and is no
longer in `contributions`. That one rule replaces the scattered
`store.replaceGraph(name, [])` calls at 755, 808 and 888. A Graphs-chip toggle
calls `applyVisibility()` without reloading `filterState`, exactly as today.

### `app/src/query/mountQueryView.js`

```js
mountQueryView(host, shell) → {
  queryNode(iri),             // 1440-1453 minus selectNode (the graph view already did it)
  queryClassPair(pair|null),  // 1465-1482
  renderSources(),            // 256-261
  savedQueries() → sorted,    // for the SPA session dump (1591-1601)
  requestMeasure(), focus(), hasFocus(),
}

shell = {
  isActive, prompt, confirm,
  createEngine: ({ onSourcesChange }) => queryClient,  // SPA: createQueryClient
  contributions: () => Contribution[],                 // for syncDocumentToEngine and the Sources chip
  selectedNode: () => iri | null,
  drawnNodeIds: () => Set<iri>,
  onReveal(iri),             // SPA: dock.revealView('graph'); if (!graphView.selectNode(iri)) flashError(...)
  onAddGraph(contribution),  // CONSTRUCT, sweepable: true
  onLint(message),           // storage errors (1161-1167)
}
```

It renders the markup from `index.html` 157-184 and moves:

- 242-261: Sources chip;
- 1102-1482: library, saved queries (prompts and confirms via `shell`), run,
  cancel, results, CONSTRUCT → `shell.onAddGraph`;
- KeyK (1645);
- the row gutter (1851-1857).

### What stays in `main.js`

- examples and the example select;
- the editor, TriG and files panes;
- the lint chip;
- `handleTextChange` as orchestration (autosave; `doc.setText`;
  `graphView.setDocument`; TriG if not dirty; `queryView.renderSources()`;
  lint; diagram list and preview);
- `handleTurtleChange` UI;
- Regenerate;
- `VIEWS`/dock, `TAB_SHORTCUTS`, `Alt+Shift+←/→`;
- session dump and destroy.

### Preserved, not fixed

A CONSTRUCT graph joins `knownGraphNames` (1415), so the next mermaid edit
sweeps it away (885-890). A minted graph does not join it and survives.
`sweepable` keeps that difference. Changing it is a separate decision.

### Phase 0 as built (2026-10-05)

Done: `rdf/documentModel.js`, `viz/mountGraphView.js`, `query/mountQueryView.js`,
a slimmer `main.js` (~560 lines, from 1857) and
`test/document-model.test.js`. Where the code differs from the sketch above, the
code wins:

- A mount takes the pane's `<section>` and writes its own inner markup;
  `index.html` keeps only the empty `#graph-pane` and `#query-pane` sections. Every
  inner id is unchanged, so `app.css` did not move.
- Added to the graph view: `shell.onApplied()` (Sources popover refresh),
  `shell.knownGraphNames()` (hidden-graph list is pruned to it, as before),
  `addContribution(c, { save })` (a CONSTRUCT result; `save` records visibility),
  `prefs()` (main applies the editor font size before the editors exist), and
  `setDocument(contributions, { keepFilters })`. `keepFilters` is the TriG-pane
  path, which never recomputed the link kinds on offer. It is not "fixed".
- `onAddGraph` in the graph shell is `(c) → Promise<note|undefined>`: the note is the
  TriG-edited suffix of the mint message. The mount keeps its own by-name copy of the
  contributions for the Graphs panel; the shell's `doc` is the source of truth.
- The query view reaches the graph only through the shell: `selectedNode`,
  `drawnNodeIds`, `onReveal`, `onAddGraph`. `mountQueryView` creates the CodeMirror
  SPARQL pane itself, so a webview bundles CodeMirror for it.
- Each mount registers its own capture-phase `keydown` listener (graph: bare keys,
  Escape, Alt+T/N/L/V; query: Alt+K). `main.js` keeps Alt+tab keys and
  `Alt+Shift+←/→`.
- Prompts and confirms in moved code are `await shell.prompt/confirm`. Saved-query
  rename, delete and save became async; nothing read their return value.

Behaviour that changed, on purpose, and why it is not visible:

- **One render per text change, not two.** `applyGraphVisibility` rendered with the
  previous filter state and `handleTextChange` rendered again with the new one.
  `setDocument` renders once with the new state.
- **A Graphs-chip toggle no longer rewrites the TriG pane.** It rewrote the same
  text: the pane shows the whole document, whatever is drawn. Adding or removing a
  graph still refreshes it, through `onAddGraph` / `onRemoveGraph`.
- The TriG pane is refreshed after the graph renders, not before.

Open for phase 1, found while moving the code:

- `shell.source.addRelation` / `changeClass` are synchronous here and
  `nodePanel.js` uses their boolean result at once (the "✓" and the panel close).
  Across a webview bridge they are asynchronous, so the panel's two callbacks have
  to accept a promise first.
- `query/queryLibrary.js` uses `import.meta.glob`, so the webview bundle needs
  esbuild's equivalent (a small plugin) or a generated index.
- `flatFromQuad(s)` from the Types section is not written yet; phase 1 needs it for
  `document` and `addGraph` messages.

Gate, met: 22 failing tests in 12 files before and after, `document-model` 9/9, and
`vite build` resolves every import. The baseline report was truncated, so the two
runs agree on counts, not on a full list of names; none of the failing files
imports a module phase 0 touched (`query-library.test.js` reads the `.rq` files off
disk). Nothing here exercises the DOM: the SPA has to be tried by hand, see below.

Try by hand (`npm run dev`, the user runs it): the Graphs / Nodes / Links / View
chips and Alt+T/N/L/V; `f g s b q < > . , / r` on a selection; double-click opens
the node and edge panels; `+` and class swap write into the editor; "mint
neighbours" prompts and survives an edit; the Graphs `✕` removes a graph; SPARQL
Run, the library and saved queries (save, rename, delete prompt); a CONSTRUCT
"Add as graph" and its reveal button; Alt+K; TriG hand-edit then Regenerate;
Dump and Destroy session; Alt+Shift+←/→.

### VS Code (phases 1–2)

Files: `vscode/src/extension.js`, `vscode/src/pipeline.js` (one
`createDocumentModel` per active document, plus `collectSourceLocations` for
reveal), `vscode/src/panels.js`, `vscode/webview/graph.js` and
`vscode/webview/sparql.js`, which are thin shells around the mounts.

| Direction     | Message                        | Payload                                                                               |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| host → graph  | `document`                     | `{ uri, version, text, contributions: FlatContribution[] }`                           |
| host → graph  | `revealNode`                   | `{ iri }`                                                                             |
| graph → host  | `reveal` / `revealEdge`        | `{ mermaidId }` / `{ keys }`                                                          |
| graph → host  | `addRelation` / `changeClass`  | same args as `shell.source`; host recomputes on live text                             |
| graph → host  | `addGraph` / `removeGraph`     | `{ contribution: FlatContribution }` / `{ name }`                                     |
| graph → host  | `selection`                    | `{ selection }`; host relays to sparql                                                |
| graph → host  | `drawn`                        | `{ nodeIds }` after each `setDocument`; host relays to sparql                         |
| graph → host  | `queryNode` / `queryClassPair` | host reveals the SPARQL panel and relays                                              |
| any → host    | `prompt` / `confirm`           | `{ id, message, value }` → reply `{ id, result }` (showInputBox / showWarningMessage) |
| sparql ↔ host | `worker`                       | the existing `queryClient` ↔ `queryWorker` protocol, unchanged                        |

- `shell.source.has*` in the webview answers synchronously from
  `collectSourceLocations(text)` of the last `document` message. The actions are
  recomputed by the host on the live `TextDocument`, so no offset crosses the
  bridge. `addRelation`/`changeClass` become `WorkspaceEdit`s.
- `createQueryClient` gains `spawn` (default `() => new Worker(...)`). The
  webview passes a worker-shaped proxy over `postMessage`, and `terminate()`
  asks the host to recreate the engine.
- `queryWorker.js` is split into `queryWorkerCore.js`, which takes
  `{ oxigraph, readSource(url) }` and handles one message, and a thin browser
  shell. The host uses the core with `require('oxigraph')` and an `fs` reader
  over the bundled `kg/`. Keep the gzip sniff (`lessons.md`, "who decompresses
  is not the client's decision").
- Panels: `retainContextWhenHidden: true`. The CSP allows
  `connect-src https://cdn.jsdelivr.net` for `ICONS_URL` (`viz/icons.js`).

### Phase 1 as built (2026-10-05)

Done: the graph tab, the TriG document, diagnostics and the Docker build.
`docker compose … vitest` gives the same 22 failing tests as before (names
compared, identical), the new tests pass, and both bundles compile. **The extension
has not been run in VS Code**; the checklist below is what is unverified.

Files (`vscode/`): `src/extension.js` (host: following the editor, reveal, edits,
TriG provider, diagnostics, commands), `src/pipeline.js` (one document model per
document, no `vscode` import), `src/flat.js` (contribution ↔ `postMessage` form,
shared with the webview), `src/panels.js` (webview panel, CSP, page), `webview/graph.js`
(the shell), `esbuild.mjs`, `package.json`, `Dockerfile`, `Dockerfile.dockerignore`,
`.vscodeignore`, `build.sh`, `README.md`. The TriG provider is inline in
`extension.js`, as planned. `app/src/query/flatQuads.js` gained
`flatFromQuad(s)`. Tests: `app/test/vscode-pipeline.test.js`.

The phase 0 open items are closed: `nodePanel.js` awaits `onAddRelation`, and the
graph view awaits `shell.source.changeClass`, so both may return a promise;
`flatFromQuad(s)` exists. The `import.meta.glob` item moves to phase 2.

How it differs from the message table above:

- Messages that exist: `ready`, `document`, `reply`, `show` (host → webview, the
  tab became visible: `fitView`), `reveal`, `revealEdge`, `addRelation`,
  `changeClass`, `prompt`, `addGraph`, `removeGraph`, `warnings`, `queryNode`,
  `queryClassPair`. `selection` and `drawn` are not sent: only the SPARQL tab reads
  them (phase 2). The two `query…` messages only show "not part of this build yet".
- `document` also carries `knownGraphNames`, and the replies to `addGraph` /
  `removeGraph` carry the new set. The webview's `shell.knownGraphNames()` reads
  that cache, so the hidden-graph list is pruned as in the SPA.
- `warnings` (webview → host) carries the warnings about the merged store, which
  only the view computes (ADR 0036). The host publishes them with the parser's.
- Reveal picks the location after the caret in the editor that already shows the
  file; if none does it opens column one, so the webview's own group never takes the
  document. The flash is a decoration type for `FLASH_MS` (2000, copied from
  `editor/revealFlash.js`).
- Edits (`addRelation`, `changeClass`) are one `WorkspaceEdit` from
  `relationInsertion` / `classTokenReplacement`, applied to the live document. The
  text-change listener redraws; nothing is written to disk.
- The graph tab and the diagnostics are driven by the same refresh: the last
  focused markdown editor, 200 ms debounce. Opening the webview or the TriG
  document does not change which file that is.
- **Diagnostics sit on line 1.** The parser's warnings are strings with no
  position, so every one is attached to the first line of the file. A position
  needs the parser to report one; the SPA's red underline for a back arrow comes
  from `backArrowSpans`, which the host does not call.
- The page ships `app/src/styles/app.css` unchanged (copied to `dist/app.css`). The
  app is light whatever the theme (`color-scheme: light` in `:root`), so no VS Code
  theme variables are bridged.
- `package.json` contributes the `trig` language id with no grammar: highlighting
  appears only if another extension provides one. Keys `Alt+G` / `Alt+R` need
  `editorTextFocus` and a markdown file, so they do not fire from the webview.
- The `.vsix` build needs `vscode/package-lock.json`, which the user creates once
  with `npm install` in `vscode/` (installs are on the deny list).

Unverified until run (`sh vscode/build.sh`, then install the `.vsix`, open
`app/src/data/examples/gdpr-signup.md`):

- the page loads under the CSP (`script-src` and `style-src` are the extension's
  own origin plus `'unsafe-inline'` for styles; `connect-src` is the icon CDN).
  Open "Developer: Open Webview Developer Tools" for violations;
- the layout: `.pane` is styled for a grid column, so the card may need
  `PAGE_STYLE` adjusted in `panels.js`;
- ELK layouts, the popover chips, double-click info panel and the keys, in the
  webview;
- `+` and the class swap write into the file and mark it dirty; `g` selects the
  line; mint asks in an input box and survives an edit; the Problems panel lists a
  `|reads|` warning.

Open for phase 2:

- the SPARQL tab: `mountQueryView` needs the engine in the host. `queryLibrary.js`
  uses `import.meta.glob`, so the webview bundle needs an esbuild plugin or a
  generated index; `createQueryClient` needs a `spawn` option (see above);
- relay `selection` and `drawn` from the graph tab to it.

### Model per task

Opus wrote this spec and reviews each phase gate (`/code-review low`). Sonnet
implements phases 0–2 from it. Haiku writes the packaging files from the plan
and runs the tests, reporting failures only.
