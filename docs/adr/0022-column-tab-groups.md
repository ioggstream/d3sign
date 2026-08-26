# 22. Column tab groups: any view in any column

Date: 2026-08-07

## Status

Accepted

Supersedes the tab and fold clauses of
[ADR 0013](0013-graph-view-controls.md).

## Context

The window was three CSS-grid columns with each pane's home written into
`index.html`: the mermaid editor was always left, the TriG pane always middle,
and the preview, graph and SPARQL panes were always tabs on the right. Panels
were markup, not data.

Two costs followed.

A user could not arrange the workspace. Wanting the graph and the SPARQL results
side by side, or the mermaid editor out of the way, meant editing the HTML. The
one exception was `Alt+,`, which folded the TriG column into a fourth tab — and
it did so by re-parenting the live pane element, which is proof that panes
survive being moved. It was a general mechanism serving exactly one pane.

Nothing persisted. Tab selection, column widths and the fold state were all lost
on reload, because they only ever existed as inline styles and `hidden`
attributes. Filters, graph visibility and view preferences were all already
stored in `localStorage`; the arrangement was the one piece of view state that
was not.

Two bugs were found in the old code and are fixed here, because the new code
depends on both being correct:

- `makeResizableGutter` read its starting sizes from
  `getComputedStyle(...).gridTemplateColumns`, which resolves to **pixels**, and
  wrote them back as `fr`. It survived only because a drag renormalises the
  ratio — but with the TriG column folded the template held literal `0px` tracks,
  so dragging the main gutter could resurrect a column the user had collapsed.
- The graph pane's `ResizeObserver` called `cy.fit()` on every tick, so any
  gutter drag or window resize discarded the pan and zoom the user had set.

## Decision

- [x] **The layout is data.** Three fixed columns, each a tab group; a view lives
  in exactly one column and is visible when it is that column's active tab. The
  model is a plain object — `{version, activeView, columns: [{views, active, weight}]}` — with pure functions returning new objects. It holds no elements
  and touches no DOM.

- [x] **Any view can be in any column.** `Alt+Shift+←` and `Alt+Shift+→` move
  the view the user last selected into the adjacent column. Shift is part of the
  chord because `Alt+Arrow` alone is a word-wise caret move, and these have to
  work while an editor has focus.

- [x] **Drag-and-drop is deliberately out of scope**, along with nested splits
  and closable views. Dragging a tab is a once-per-session gesture whose
  implementation — pointer capture, drop indicators, hit-testing over a canvas
  and two `contenteditable`s — is untestable in this suite and is the highest
  bug surface in the feature. The model is a list of columns rather than
  markup, so adding drag later is a new module, not a rewrite.

- [x] **Three columns, not a tree.** A row/column tree would cost little in the
  model and buy nested splits, but it would also need a reconciler, and the
  three columns are what the app's own proportions are built around (the TriG
  column's width budget, [ADR 0009](0009-direct-rdf-import.md); the SPARQL
  pane's results table wanting the widest column, [ADR
  0021](0021-sparql-query-pane.md)).

- [x] **A pane element is mounted once and never unmounted.** Moving a view is
  `appendChild` of the element that is already there. A rebuild would mean a new
  cytoscape instance and a new CodeMirror `EditorView`, discarding the drawing's
  zoom, the editor's undo history and the TriG pane's dirty state. This is also
  why no third-party dock library is used: the ones that keep the element would
  need an adapter about as large as this module, and the ones that are smaller
  recreate panel DOM on every move, which is disqualifying here.

- [x] **Column widths are remembered weights, renormalised over the non-empty
  columns.** An empty column is exactly zero wide and its neighbours share out
  what it would have had, so folding a column away and bringing it back needs
  nothing remembered on the side. The column and its gutter keep their grid
  tracks — a `display: none` grid item stops being placed and would slide the
  next column into a 6px gutter track, which is the same reason ADR 0013 gave.

- [x] **A gutter divides the nearest two non-empty columns.** With a column
  empty, its two gutters would otherwise sit side by side as 12px of dead space,
  and dragging either would move width into a column that is not on screen.
  Only the gutter to the left of each adjacent pair is live; the rest collapse
  to zero. The layout gutters take their starting sizes from the model rather
  than from the resolved grid template, which is what makes the pixels-as-`fr`
  bug above unrepresentable.

- [x] **The arrangement is persisted** to `localStorage` under
  `d3fend-graph:layout`, debounced, alongside the filters and view preferences.
  A stored layout is reconciled against the views this build actually has:
  unknown ids are dropped, a view added since the layout was saved is placed in
  the column its registry entry asks for and made that column's tab, and
  anything unparseable falls back wholesale to the default. Without this,
  renaming a view id would leave a tab that opens nothing and a new feature
  would ship invisible to every existing user. A "Reset layout" button in the
  header clears the key.

- [x] **A view is declared once**, in a registry array: id, title, shortcut,
  element, default column, and the `onShow`/`onMove` hooks. The tab shortcut
  table is derived from it, and the tab prints its chord from the same field the
  table is keyed on — so the drift ADR 0013 warns about between a printed hint
  and the key that is actually matched cannot happen for tabs. (It remains
  possible for the chips and the graph keys, which are still written twice.)

- [x] **`Alt+,` keeps its three-state cycle** — own column → a tab beside the
  others → that tab selected → own column — but now as a general operation on
  the model: `cycleView` sends any view between its `homeColumn` and its
  `defaultColumn`. Folding leaves the destination showing the tab it already
  had, so the freed width goes to what the user was looking at. The TriG pane's
  header button does the same thing.

- [x] **The graph re-frames on show, not on resize.** `resize()` re-measures;
  `fitView()` re-measures and frames the drawing. The `ResizeObserver` calls the
  first, so a gutter drag no longer discards the user's pan and zoom; being
  moved or revealed calls the second, since cytoscape measures a `display: none`
  container as zero. The CodeMirror panes need the same treatment for the same
  reason — they cache geometry read while hidden — plus a focus restore, because
  re-parenting an element blurs whatever inside it had the caret.

- [x] **Bare-key shortcuts gate on visibility, not on focus.** `f g s q < >` ask
  "is the graph on screen, is the user not typing, is the info modal closed".
  ADR 0013's first guard was "the graph is the tab on screen", which was
  sufficient when only one right-column pane could be visible at a time. It no
  longer is: the graph and the SPARQL pane can now be in different columns and
  both on screen, and `q` means something to both. The "not typing" guard covers
  the case that matters — the caret being in the query editor — so this is
  accepted rather than fixed. Tracking which column owns the keyboard would be
  more precise and is the fix if a bare key ever fires for the wrong pane.

## Consequences

Pros:

- The arrangement is the user's, and it survives a reload — as do the column
  widths and which tab each column was showing.
- Adding a view is one registry entry: no HTML, no CSS, no shortcut table edit,
  and existing users get it placed and selected rather than hidden.
- `main.js` loses `selectTab`, `setTurtleFolded`, `cycleTurtlePane`,
  `expandedColumns`, the hardcoded gutter track indices and the window-resize
  handler — about 120 lines and a category of DOM-derived state.
- Everything worth asserting is in a pure module, so the layout is unit-tested
  in node like the rest of the logic.

Cons:

- The renderer is untested. The suite runs in node with no jsdom (28 test files
  establish that), and adding jsdom for one module would be a larger change than
  this feature. The split is enforced by keeping the model free of DOM.
- A bare graph key can fire while the user's attention is on an unfocused SPARQL
  pane, as above.
- A column can now hold every view at once. The tab bar scrolls horizontally
  rather than wrapping — a second row would eat the panel's `1fr` track — but
  there is no overflow menu, so a narrow column with five tabs is awkward.
- The default arrangement's proportions changed very slightly: widths are now
  weights renormalised over the non-empty columns, so docking the TriG pane back
  gives 20/20/60 where the old fixed `1fr 6px 1fr 6px 2fr` gave 25/25/50. The
  boot state (TriG folded) is unchanged at 25/75, and the first gutter drag
  replaces both with the user's own numbers.

## DONTREADME

Notes for LLM agents. They describe the code as it is, not the decision, and go
stale: check the code before trusting them.

- The model is [app/src/layout/model.js](../../app/src/layout/model.js) —
  `createDefaultLayout`, `moveView`, `moveViewBy`, `setActiveTab`, `setWeights`,
  `renderedFractions`, `migrate`. Pure; no DOM. Tested by
  [app/test/layout-model.test.js](../../app/test/layout-model.test.js).
- Storage is [app/src/layout/persist.js](../../app/src/layout/persist.js)
  (`d3fend-graph:layout`, debounced), tested by
  [app/test/layout-persist.test.js](../../app/test/layout-persist.test.js).
- The renderer is [app/src/layout/columns.js](../../app/src/layout/columns.js).
  `createColumnLayout({grid, columnEls, gutterEls, views})` returns
  `isVisible / activeView / revealView / moveActiveViewBy / focusTab / cycleView / reset`. `renderSizes` is the part a drag re-runs; `renderContent` rebuilds
  the tab bars and re-parents panes, and is what fires `onShow`/`onMove`. Hooks
  are suppressed on the first render, because the panes have not been built yet.
- The view registry is the `VIEWS` array in `main.js`, not a module of its own:
  the hooks close over `graphPane`, `editorPane`, `turtlePane` and `queryPane`,
  which live there.
- `index.html` holds the panes in the column they ship in, with an empty
  `.tab-bar` per column. Every pane id is unchanged from before this ADR, so the
  `getElementById` lookups at the top of `main.js` still work — only the panes'
  parent moves.
- `makeResizableGutter`
  ([app/src/layout/resizer.js](../../app/src/layout/resizer.js)) now has two
  modes. Model-backed (`getSizes`/`setSizes`, used by the column gutters) drags
  the caller's fraction array; DOM-backed (neither, used by the `#query-grid`
  row gutter inside the SPARQL pane) keeps the old read-the-template behaviour.
  `beforeIndex`/`afterIndex` may be functions, because which columns a gutter
  divides changes as columns empty and refill. It returns a teardown.
- `graphPane` exposes `resize()` (measure) and `fitView()` (measure and frame);
  the `ResizeObserver` calls only the first. The CodeMirror panes expose
  `requestMeasure()`, `hasFocus()` and `focus()`.
- `.col--empty` (was `.col--hidden`) collapses a column; `.pane[hidden]` (was
  `.tab-panel[hidden]`) hides a pane, because `.pane` sets `display: flex` and
  every pane is a tab now.
