# 23. A browser-local file store for the source document

Date: 2026-08-08

## Status

Accepted

Fills in the "only one markdown file will be supported, but in the future we may
support multiple" note in [ADR 0011](0011-visualize-markdown-not-mermaid.md).

## Context

The markdown document was the one piece of state the app never kept. It was
seeded from a bundled example at boot — `import.meta.glob` over
`src/data/examples/*.md` — and every reload threw the edits away. During
development that is every reload `npm run dev` triggers, so the loss was
constant rather than occasional.

Meanwhile all the *view* state around it was persisted: the layout
([ADR 0022](0022-column-tab-groups.md)), the graph filters, the view
preferences, the hidden graphs. The document the user was actually writing was
the only thing that was not.

The examples cannot serve as the library. They are read-only bundle assets: a
user's document is not one of them, and there is nowhere to put it.

## Decision

- [x] **The working copy is autosaved; named files are explicit.** These are two
  different promises. Autosave answers "I reloaded and lost my work" and must
  cost nothing to get — no button, no naming, no decision. A named file answers
  "I want to come back to the version I had on Tuesday" and must not happen
  behind the user's back, because an implicit snapshot of every state a document
  passes through is a list nobody can read. So the working copy is written on
  every change and restored at boot, and `Save as…` is what puts a document in
  the list.

- [x] **`localStorage`, not IndexedDB.** The editor is constructed with its text
  (`createEditorPane(host, initialText, onChange)` fires its first `onChange`
  synchronously), so the boot read has to be synchronous or the whole startup
  path becomes async for the sake of a few KB. IndexedDB is also untestable in
  this suite — it runs in plain node with no jsdom — whereas `localStorage` is a
  three-method stub the storage tests already use. Documents are a few KB and the
  quota is ~5 MB.

- [x] **Two shapes of key, not one blob**: the index (the file list plus the
  working copy) under `d3fend-graph:files`, and one content string per saved file
  under `d3fend-graph:files/<id>`. Autosave runs on every keystroke burst and
  touches only the index, so a library of saved documents is not re-serialized to
  make a character stick.

- [x] **Only the markdown pane is stored.** The TriG pane is a serialization of
  what the markdown produced and the SPARQL pane is scratch with its own bundled
  library; neither is a document the user authors and comes back to. Storing them
  would mean deciding what it means for a stored TriG to disagree with a stored
  markdown, which is a question this feature does not have to answer.

- [x] **Dirtiness is content, not a flag — except where there is nothing to
  compare against.** With a file behind the working copy, "unsaved" means the
  text differs from the file, so editing back to what was saved clears the badge.
  With no file behind it — a freshly loaded example — there is nothing to diff,
  so a `pristine` bit carries it: loaded is clean, one keystroke later is not.
  Without that bit the badge would be lit from boot and would mean nothing.

- [x] \*\*Import and export are a Blob download and an `<input type="file">.** `showSaveFilePicker\` would let the app write back to a real file on disk, but
  it is Chromium-only and its handles need re-permissioning; a store that is
  already browser-local gains little from a handle it cannot keep in Firefox.

- [x] **Limits are refusals, not evictions.** `MAX_FILES`, `MAX_FILE_BYTES` and
  `MAX_TOTAL_BYTES` are checked in the model and a violation returns `{error}`
  that the pane reports. Making room by deleting the oldest document would be the
  storage layer deciding which of the user's work matters.

- [x] **A failed write is reported**, unlike `layout/persist.js`, which swallows
  one on purpose. Losing an arrangement costs a drag; losing a document costs the
  work. The adapter classifies the failure as `quota` or `unavailable` and raises
  it once per reason, so a full quota does not produce one message per keystroke.

- [x] **Deleting the open file does not empty the editor.** The working copy
  simply loses its base and becomes unsaved work. Clearing the pane would make
  Delete a destructive action on something the user did not point at.

- [x] **The pane is a view like any other** — one `VIEWS` entry, `Alt+F`, left
  column by default. Existing users get it placed and selected by the layout
  migration, which is the mechanism ADR 0022 put there for exactly this.

## Consequences

Pros:

- Edits survive a reload, which during development means they survive every HMR
  restart.
- Documents can be kept side by side and switched between, which the examples
  dropdown never allowed for anything the user wrote.
- Export gives a real backup path off `localStorage`, and import gives a way back
  in, so the feature is not a one-way door into browser storage.
- All the logic is in two modules with no DOM, so it is unit-tested in node like
  the rest.

Cons:

- The library is per-browser and per-origin. A different browser, a different
  machine or a cleared site data is an empty library, and private-browsing modes
  can refuse the writes outright. Export is the only answer offered.
- The quota is shared with the view state, which has no such guard: a library
  near its ceiling makes a layout write more likely to fail silently.
- The pane, the transfer helpers and the `main.js` wiring are untested, for the
  reason ADR 0022 gives — no jsdom in this suite.
- There is no version history: `Save as…` twice under one name yields
  `doc (2).md`, which is snapshotting by hand.

## DONTREADME

Notes for LLM agents. They describe the code as it is, not the decision, and go
stale: check the code before trusting them.

- The model is [app/src/files/fileStore.js](../../app/src/files/fileStore.js) —
  `createEmptyStore`, `migrate`, `isDirty`, `sortedFiles`, `uniqueName`,
  `setWorkingContent`, `openScratch`, `openFile`, `saveAs`, `saveOver`,
  `renameFile`, `deleteFile`, `duplicateFile`, `importFile`. Pure; no DOM, no
  storage; every mutator returns a new store and every fallible one returns
  `{store, ...}` or `{error}`. Tested by
  [app/test/file-store.test.js](../../app/test/file-store.test.js).
- The store shape is
  `{version, working: {baseId, content, updatedAt, pristine}, files: [{id, name, content, createdAt, updatedAt}]}`.
  `working.baseId` is the file the working copy came from, or `null`.
- Storage is
  [app/src/files/filesPersist.js](../../app/src/files/filesPersist.js) —
  `loadStore`, `saveStore` (structural, 150 ms), `saveWorking` (index only,
  500 ms), `flushStore` (for `beforeunload`), `clearStore`, `onStorageError`.
  One timer serves both debounces; a structural request pending behind an
  autosave takes the shorter delay. Orphaned content keys are pruned by diffing
  against the index that is already on disk, so it never enumerates
  `localStorage`. Tested by
  [app/test/files-persist.test.js](../../app/test/files-persist.test.js).
- The pane is [app/src/files/filesPane.js](../../app/src/files/filesPane.js)
  (`renderFilesPane(host, store, handlers, now)`, rebuilt wholesale like
  `viz/diagramList.js`) and
  [app/src/files/fileTransfer.js](../../app/src/files/fileTransfer.js)
  (`downloadText`, `pickTextFile`). Names are entered through `window.prompt`:
  the app has no dialog infrastructure outside the node `<dialog>`.
- `main.js` holds the single `fileStoreState` and the `applyFileResult` /
  `renderFiles` / `confirmDiscard` helpers. Autosave is the first statement of
  `handleTextChange`, so it rides the editor's own change debounce and blur
  flush. The boot read sits just above `initialText`, and the example dropdown
  goes through `openScratch` after `confirmDiscard`.
- `#files-pane` is static markup in `index.html` inside `#col-left`, with
  `#files-host`, `#files-dirty` and the Save as / Import / Export buttons.
