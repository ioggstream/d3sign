# 42. Find and focus a node

Date: 2026-10-03

## Status

Accepted.

Completes the half of [0017](0017-go-to-mermaid-source.md) that was named and
not built: "the reverse direction (caret → highlight the node in the graph)".

## Context

Every graph shortcut acts on the selection. `f` folds the selected container,
`g` jumps to its mermaid line, `s` swaps the selected link, `b` starts the
reading there, `>` and `<` walk its flow. Nothing gets a reader *to* a
selection. The only ways in are clicking the node — which means finding it by
eye first — and the SPARQL pane, which reveals a node from a result row.

On a diagram small enough to take in at a glance that is no gap. On one that is
not, the reader already knows the name of the node they want and has no way to
say it. ADR 0017 described the symptom from the other side: before go-to-source
existed, the way to get from the drawing to the text was to type the name into
the editor's find panel. The graph never got a find panel of its own.

Dimming the parts of a drawing that are not currently in question is already how
this view answers a question: a path focus lights the flow and fades the rest
([00032](00032-improve-flow-discovery.md)). A search is the same shape of
answer over a different set, so it should not look like a second idea.

Moving the viewport is the part with a real cost. A reader who has zoomed in has
done so deliberately, and a search that reframes the drawing every time would
undo whatever they were in the middle of. But a search that never moves the view
fails the case it exists for: the whole diagram framed, every node an unreadable
speck.

## Decision

- [x] `/` MUST open a find bar over the graph canvas and put the caret in it. It
  MUST be subject to the same guards as every other bare graph key — graph
  visible, focus not in a text field, focus outside the information panel — and
  it MUST call `preventDefault`, so the browser's own quick-find does not open
  on top of it.
- [x] Matching MUST be case-insensitive substring, over the node's mermaid id
  and its label, and MUST NOT search edges. Which fields are searched MUST stay
  a single list in one module, not a mechanism the user configures.
- [x] Typing MUST NOT move the viewport. The hits are lit where they are; going
  to one is a separate press.
- [x] A running search MUST say how many nodes matched, and MUST distinguish
  "nothing typed yet" from "typed, and nothing matches".
- [x] Matching nodes MUST be shown at full strength and everything else dimmed,
  reusing the path focus's own dim class. A search and a path focus MUST NOT be
  on screen together: whichever was asked for last wins.
- [x] A query that matches nothing MUST dim nothing.
- [x] `↓` and `↑` MUST walk the hits, wrapping, focusing each one without
  closing the bar and without touching the editor.
- [x] `Enter` MUST take the hit the bar is sitting on: select it, focus it,
  close the bar, and reveal the mermaid line it was written on. `Escape` MUST
  close the bar and clear the dimming without moving the viewport.
- [x] Focusing a node MUST centre it in a single viewport call, and MUST only
  ever raise the zoom — never lower it — to a floor at which the node is drawn
  at its natural size.
- [x] A focused node MUST be haloed briefly, for the same two seconds the
  editor's reveal flash lasts.
- [x] The view MUST NOT learn what mermaid is: the reveal MUST go out through
  the same callbacks the right-click menu's "Go to mermaid source" already uses
  ([0014](0014-graph-view-from-rdf-only.md)). A node with no mermaid origin
  simply gets no jump, as it already gets no menu item.
- [x] The matcher MUST be a pure function of plain records, with no cytoscape
  and no DOM, so it is asserted on in a suite that has no browser.
- [x] A redraw MUST re-derive the hits from what is drawn rather than remember
  them, so a node a fold has just swallowed stops being a hit instead of
  becoming an id that no longer resolves.

## Consequences

Pros:

- The reader can reach any node they can name, which is the one thing selection
  was missing. Every other graph shortcut becomes reachable by name as a result:
  `/`, `Enter`, then `>` walks the flow of a node nobody had to find by eye.
- Nothing new had to be taught about the drawing. The dimming is the one the
  path focus already uses, the halo is the one go-to-source already flashes in
  the editor, and the input is the box the filter chips already open.
- Nothing in the go-to-source chain changed. The search reaches it through the
  callbacks that were already there, so ADR 0014's boundary holds without the
  pane gaining a single line about mermaid.
- The zoom floor only ever raises, so a reader working zoomed in keeps their
  magnification while a reader looking at the whole diagram still lands on
  something legible.

Cons:

- `/` is spent, and after it the unshifted keys are nearly gone. The chord
  budget was already noted as tight.
- Search and path focus share the dim class and therefore cannot coexist.
  Searching *within* a flow is a reasonable thing to want and is not possible;
  it would need a second visual vocabulary, which is the cost this avoided.
- `Enter` reveals the mermaid line, and revealing focuses the editor — so after
  a commit the bare graph keys are inert until focus returns to the graph. This
  is exactly what `g` already does, so it is a consequence rather than a new
  rule, but it does mean `/ … Enter >` does not work as one gesture.
- The hits are re-derived on every redraw, so the position in the walk is lost
  whenever the drawing changes under an open bar. Keeping it would mean
  deciding what "the third hit" means in a drawing that is no longer the same
  one.

## DONTREADME

Notes for agents working on this. These go stale; check the code.

- `app/src/viz/nodeSearch.js` — the whole of the matching. `matchNodes(records, query)` takes `{ id, displayId, name }` records and returns ids, best first.
  `SEARCH_FIELDS` is the field list; `rankOf` gives two ranks per field so every
  prefix hit sorts above every substring hit, ties going to the earlier field.
  A blank query returns `[]`, which the pane reads as "no search running".
- `app/src/viz/graphPane.js` — `createSearchBar` builds the overlay beside
  `createContextMenu` and `createNodeTooltip`, and carries the menu's warning:
  it is interactive, so it stops `mousedown`/`mouseup`/`click`, or cytoscape
  reads a click in the input as a click on the background. Keystrokes are
  deliberately *not* stopped — the shell's listener is on `window` in the
  capture phase, and what keeps `f` from folding mid-word is `isTypingTarget`.
  The input is `type="text"`, not `type="search"`, which swallows Escape.
- `focusNode` reuses `anchoredViewport` (`viz/viewAnchor.js`) with the host's
  centre as the rendered point — one `cy.viewport()` call, for the reason
  `restoreAnchor` documents. `SEARCH_ZOOM_FLOOR` is the floor; `Math.max` with
  the current zoom is what makes it a floor and not a setting.
- `app/src/viz/graphStyle.js` owns `SEARCH_HIT_CLASS` and `SEARCH_FOCUS_CLASS`
  and the amber they are drawn in; `graphPane.js` imports them, so only one file
  spells the names. Both rules sit before `node:selected` so selection still
  wins.
- `app/src/main.js` — one `GRAPH_SHORTCUTS['/']` entry calling
  `graphPane.openSearch()`. No new listener and no new guard.
- `app/src/styles/app.css` — `.graph-search` at z-index 25, above the context
  menu's 20. Like `.graph-node-tooltip` it must set no `display` in its base
  rule: it lives inside the cytoscape container, and a box that cannot hide
  changes the client size `cy.resize()` measures. The flex is on
  `.graph-search:not([hidden])` for that reason.
- Tests: `app/test/node-search.test.js` for the matcher, and a `search classes`
  block in `app/test/graph-style.test.js` pinning the class names and the rule
  order. The bar and the viewport maths are untested — the suite has no jsdom.
