# 13. Graph view controls: layout choice, rotation, tabbed right column

Date: 2026-08-01

## Status

Accepted; the tab and fold clauses are superseded by
[ADR 0022](0022-column-tab-groups.md), which makes every column a tab group and
lets any view live in any of them. The layout, rotation, chip and bare-key
clauses stand — except that the bare keys now gate on the graph being *visible*
rather than on it being the selected tab, since two panes can be on screen at
once.

## Context

The D3FEND Graph view was hardwired to a single ELK `layered` layout with a
fixed orientation. Two limits showed up in use:

- some diagrams read better as a tree, a radial fan, or a force layout, and
  ELK layered is not always the best fit;
- even with a good layout, the drawing's orientation may not match the pane's
  aspect ratio (a tall drawing in a wide pane wastes horizontal space).

Separately, the right column used to split its height between the mermaid
preview and the graph. Both views want the full column, and only one is looked
at at a time.

## Decision

- [x] The layout algorithm is chosen from a dropdown in the graph pane header.
  Only algorithms bundled with cytoscape core or `cytoscape-elk` are
  offered (ELK layered/tree/stress/force/radial, cose, breadth-first,
  concentric, circle, grid) — no new dependency, works offline. Entries
  that flatten compound (container) nodes are labelled `(flat)`.

- [x] Rotation is a view transform, not a layout option: two buttons turn the
  drawing 90° clockwise / counter-clockwise by rotating node positions
  around the drawing's centre. This works identically for every algorithm,
  instead of only for the ones exposing a direction option.

- [x] The rotation is kept as pane state and re-applied after every layout run,
  so filtering or editing the diagram does not snap the view back to the
  algorithm's own orientation.

- [x] The mermaid preview and the D3FEND Graph are two
  tabs of the right column, not two stacked panes.
  Only the selected panel is in the layout, so it gets
  the whole column height; the graph tab is selected
  on load.
  *Generalised by [ADR 0022](0022-column-tab-groups.md): every column is a tab
  group and either view can be moved to any of them.*

- [x] Each tab has a shortcut: `Alt+M` for the mermaid
  preview, `Alt+G` for the graph. They answer even
  while the editor has focus.

- [x] The graph pane's chips are reachable from the keyboard while the graph tab
  is showing: `Alt+T` opens the Graphs chip, `Alt+N` the Nodes chip, `Alt+L` the
  Links chip, `Alt+V` the View chip
  ([ADR 0015](0015-graph-visualization-preferences.md)). Every chip prints its
  own chord beside its label, styled like the tabs' — a chip is the only place
  its popover is opened from, so it is where the chord is learnt, and no chip is
  reachable by mouse but not by key. The two searchable filter chips
  put the caret in a search box: typing narrows the list, `Enter` flips the
  visibility of every entry still listed (pressing it again undoes it),
  `Escape` closes the popover and changes nothing. The query is view-only
  state — it never reaches the store or the filter state — so filtering
  re-renders that popover alone.
  The shortcuts are inert on the mermaid tab: the chips live in the graph
  pane header, and a hidden pane has no position to anchor a popover to.

- [x] The graph pane header carries a box naming the selected element, and
  unmodified letters act on it: `f` folds or unfolds
  ([ADR 0012](0012-fold-container-nodes.md)), `g` jumps to its mermaid source
  ([ADR 0017](0017-go-to-mermaid-source.md)), `s` swaps a link's direction
  ([ADR 0019](0019-select-and-swap-edges.md)). Both nodes and edges can be
  selected, so each key asks the selection what kind it is and declines on the
  wrong one — `f` means nothing on a link and `s` nothing on a node, while `g`
  answers on both. A key that declines is still swallowed: it belongs to the
  graph, so it must not fall through to whatever else is on screen. Each is also
  printed beside the matching item on the element's right-click menu, which is
  where a user finds out they exist. These are the first shortcuts with no
  modifier, so the first that can be confused with typing, and they need two
  guards the `Alt` chords do not:

  - the graph must be on screen, as for the chips —
    since [ADR 0022](0022-column-tab-groups.md) that
    means "visible in whichever column holds it",
    which is weaker than it was: the SPARQL pane can
    now be visible at the same time, and `q` means
    something to both;
  - and focus must not be in a text field. That second
    check is not implied by the first: the mermaid
    editor is a column, not a tab, so it is visible at
    the same time as the graph and "the graph tab is
    active" is true while the user is typing into it.

  They are matched on the character typed rather than the physical key, unlike the
  `Alt` chords which have to use the key position because `Alt` composes
  characters — these are mnemonics (`f` for fold, `g` for go), so they should
  follow the letter. The keystroke is only swallowed once the guards pass, so a
  letter these shortcuts decline still reaches whatever had focus.

- [x] `Alt+,` folds the TriG column away and hands its
  width to the graph. It answers from any tab — this
  is a layout shortcut, not a graph one.

- [x] A folded TriG pane is not gone: the same section
  is moved into the views column and appears as a
  third tab beside the preview and the graph, labelled
  with its `Alt+,` shortcut like they are. The key
  therefore cycles docked → folded (graph keeps the
  width) → TriG tab selected → docked.
  *The cycle is unchanged, but [ADR 0022](0022-column-tab-groups.md) expresses
  it against the layout model, so the "only one home is live at a time" rule and
  the hidden-tab special case are gone: every view is a tab in exactly one
  column at all times, and the TriG pane starts folded rather than docked.*

- [x] Layout spacing and the rotation geometry are
  pure data and pure functions, kept out of the module
  that owns the cytoscape instance so they are
  unit-testable without a browser. Each layout's
  options are a function of the view preferences, so
  spacing follows the `View` chip's slider
  ([ADR 0015](0015-graph-visualization-preferences.md))
  rather than being frozen in the module.

## Consequences

Pros:

- Layout choice and orientation are independent, so any algorithm can be
  oriented to fit the pane.
- Adding a layout is a single table entry.
- The graph and the preview each get the whole right column.

Cons:

- Only childless nodes are repositioned when rotating (cytoscape derives a
  compound parent's box from its children); node and edge *labels* stay
  upright, so a rotated drawing is not a rigid rotation of the rendered image.
- Non-hierarchical layouts ignore container nesting, so a rotated or
  re-laid-out view may not show containment as clearly as ELK layered.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- Layout definitions (`LAYOUTS`) and the rotation
  geometry are in
  [app/src/viz/layouts.js](../../app/src/viz/layouts.js);
  [app/src/viz/graphPane.js](../../app/src/viz/graphPane.js)
  applies them.
- The tabs are generated per column by
  [app/src/layout/columns.js](../../app/src/layout/columns.js) from the layout
  model; `selectTab` is gone. See
  [ADR 0022](0022-column-tab-groups.md)'s DONTREADME.
- A chip's chord lives in one place, the `shortcut`
  option of `createFilterChip`
  ([app/src/viz/filterChip.js](../../app/src/viz/filterChip.js)),
  which both prints it and folds it into the tooltip
  `setCount` rewrites; the key it is matched on is the
  `CHIP_SHORTCUTS` table in `main.js`, so the two have
  to be kept in step.
- Tab shortcuts are registered on `window` in the
  capture phase, so CodeMirror does not swallow them.
  The table is derived from the `VIEWS` registry in
  `main.js`, which is also what prints the chord on
  the tab. Cytoscape is re-fitted by the view's
  `onShow` hook, since it cannot measure a
  `display: none` container.
- The text-field guard for `f` covers CodeMirror
  (which is `contenteditable`), the chips' search
  boxes, and the layout dropdown, which jumps to a
  matching option when a letter reaches it. The same
  guard also refuses while the info modal is open,
  which is one check for both the node and the edge
  panel — they share the `<dialog>`.
- The unmodified keys are the `GRAPH_SHORTCUTS` table
  in `main.js`, keyed by character. Their hints are
  written a second time in
  [app/src/viz/nodeMenu.js](../../app/src/viz/nodeMenu.js)
  and nothing enforces that the two agree, so a new
  key means editing both.
- `Alt+,` is `dock.cycleView('trig')`; the width it
  frees is redistributed because column widths are
  weights renormalised over the non-empty columns
  ([ADR 0022](0022-column-tab-groups.md)). The empty
  column and its gutter stay grid items with their
  tracks collapsed to `0`, since a `display: none`
  grid item stops being placed and would slide the
  next column into a 6px gutter track.
