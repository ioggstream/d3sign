# 37. The info panel is a card over the graph, not a modal

Date: 2026-09-14

## Status

Accepted

Supersedes the presentation clauses of
[ADR 0008](0008-show-node.md) that make the info panel a modal.

## Context

[ADR 0008](0008-show-node.md) put the node and edge information in one native
`<dialog>` opened with `showModal()`, and listed the cost in its own
Consequences: *"The modal's native backdrop blocks interaction with the
underlying graph while open: the user must close it before clicking a different
node, unlike a non-blocking sidebar or tab."*

That cost is paid on every use. The panel describes a node in a drawing, and
while it is open the drawing is behind a scrim and inert — the reader cannot see
where the node sits, cannot follow the links the panel is listing, and cannot
pan to look. The `+` that adds a relation ([ADR 0018](0018-add-defensive-measure.md))
and the mint button both change the graph, and neither result is visible until
the panel is dismissed.

ADR 0008 considered a tab alongside the other panes and rejected it: a tab needs
a fixed layout slot, and the Attack/Defense sections want room to grow. Both
objections are about *where the panel is docked*. Neither is an argument for the
backdrop, which is what actually hides the graph.

## Decision

- [x] **The panel opens with `show()`, not `showModal()`.** A non-modal
  `<dialog>` is not in the top layer: it is an ordinary absolutely positioned
  child of its nearest positioned ancestor. The element was already declared
  inside `#graph-pane`, which is already `position: relative`, so it becomes a
  card floating over the graph — no backdrop, no focus trap, no pointer
  blocking. The graph stays visible and fully interactive underneath: pan, zoom,
  select, fold, and watch a `+` land.

- [x] **Anchored bottom-right of the graph pane, and bounded by it.** Bottom
  right, so it never covers the pane header's chips. Its caps are `100%` of the
  pane rather than `80vw`/`80vh`, because the pane is what it floats in: a narrow
  graph column gives a narrow card instead of one hanging over the neighbouring
  editor, and the largest "Panel text size" still fits.

- [x] **It stays pinned to what it was opened on.** The opening gestures are
  unchanged — double click, or `Show info` on the right-click menu — and a single
  click still only selects ([ADR 0012](0012-fold-container-nodes.md)). A live
  "follows the selection" inspector was the obvious alternative now that both are
  on screen at once, and is declined: every click would rebuild the card,
  including the ones that were aimed at panning or at picking a node to fold, and
  the reader would lose the panel they were halfway through reading. Comparing
  two nodes is also a real use, and it needs the panel to stay put while the
  other node is clicked.

- [x] **`Esc` becomes the app's job.** The UA cancels only modal dialogs, so the
  keystroke ADR 0008 decided on stops working by itself. It is handled in the
  window key handler ahead of the other bare keys, and skipped while the caret is
  in a text field so that an `Esc` meant for a CodeMirror autocomplete reaches
  it.

- [x] **Graph shortcuts are no longer suppressed while the panel is open.**
  [ADR 0022](0022-column-tab-groups.md) gates the bare keys on "is the info modal
  closed", whose reason — the keystroke would act on an element hidden behind it
  — is exactly what this ADR removes. The clause becomes "focus is not inside the
  panel", which keeps the part that survives: a key pressed on one of the card's
  own controls is not a graph key. The distinction matters immediately, because
  `show()` puts focus on the card's close button.

- [x] **Dragging and resizing the card are out of scope.** It is a fixed corner
  of the pane. A card the user can move is the fix if a drawing regularly hides
  behind it, and nothing here forecloses it.

## Consequences

Pros:

- The graph is visible and usable while its own information is on screen, which
  is what the rejected tab in ADR 0008 was after — without spending a layout slot
  or shrinking another pane.
- What the panel's buttons do to the drawing is now watchable as it happens.
- The card travels with the graph pane when the view is moved between columns
  ([ADR 0022](0022-column-tab-groups.md)), so it no longer has to be closed on
  `onMove` — re-parenting the ancestor of a top-layer modal was the reason, and
  there is no longer a top-layer modal.

Cons:

- The card covers part of the drawing, and cannot be moved out of the way; the
  only remedies are closing it and panning underneath it.
- No focus trap. A keyboard user tabbing past the last control leaves the card
  for the graph, which is the point, but it also means the panel is easy to leave
  without noticing it is still open.
- The card is bounded by the graph pane, so a user who has narrowed that column
  reads the panel in a narrow column too. As a modal it always had the window.
- Two behaviours that the platform used to provide — `Esc`, and "clicks go
  nowhere else" — are now the app's, and only the first was re-implemented.

## DONTREADME

Notes for LLM agents. They describe the code as it is, not the decision, and go
stale: check the code before trusting them.

- The two `host.show()` calls are the ends of `renderNodePanel`
  ([app/src/viz/nodePanel.js](../../app/src/viz/nodePanel.js)) and
  `renderEdgePanel`
  ([app/src/viz/edgePanel.js](../../app/src/viz/edgePanel.js)). One `<dialog id="node-panel">` in `app/index.html` serves both, so at most one is open.
- Placement is the `.node-panel` rule in
  [app/src/styles/app.css](../../app/src/styles/app.css). `margin: 0` is
  load-bearing: the UA centres an open dialog with `margin: auto`, which fights
  the `inset`. So is `z-index: 25` — the graph tooltip (15) and context menu (20)
  are children of `#cy-host`, which sets no `z-index` and so opens no stacking
  context of its own, leaving them to compete with the card directly.
- `--c-scrim` was deleted with the `::backdrop` rule; it had no other user.
- `Esc` and the shortcut gate are both in
  [app/src/main.js](../../app/src/main.js) — the `keydown` listener and
  `isGraphShortcutContext`.
- The suite is vitest in plain node with no jsdom, so none of this is covered:
  `app/test/node-panel.test.js` and `app/test/edge-panel.test.js` test the pure
  helpers only.
