# 39. Change a node's class from the node panel

Date: 2026-09-16

## Status

Accepted

## Context

The node panel already reads a node's class off the mermaid source and
shows what D3FEND, DPV or the legal vocabulary say about it
([ADR 0008](0008-show-node.md)). It has no way to say "actually, this is
the wrong class" — that means finding the node's declaration in the
mermaid pane and retyping the CURIE by hand, which means already knowing
what the alternative is called.

[ADR 0018](0018-add-defensive-measure.md) gave the panel its first write
into the document — a relation, added as new lines below a node's
declaration. This is the panel's second write, and a different shape: it
does not add anything, it replaces one existing token — the class CURIE —
on the line the node is already declared on.

## Decision

- [x] Each class heading in the panel — D3FEND or any other vocabulary the
  hierarchy projection knows — gets a dropdown of that class's parents,
  siblings and children, pre-selected on the class the node currently has.
  Picking a different one is the whole gesture; nothing is typed.
- [x] The alternatives are the hierarchy neighbourhood, not a search over
  every class in every vocabulary. A node is usually mistyped as one class
  away from the right one — too broad, too narrow, or the sibling that
  actually matches — and the neighbourhood answers that without asking the
  user to search the ontology from the panel. A class with no parent,
  sibling or child gets no dropdown at all.
- [x] The rewrite touches only the class token, in place, on the line the
  node is declared on. The node keeps its id, its shape, and every other
  word of its label — a `Password` node retyped to `Credential` reads
  `id[d3f:Credential Password]` until the label is edited separately, which
  is a second decision the dropdown is not making for the user.
- [x] No marker comment, unlike [ADR 0018](0018-add-defensive-measure.md)'s
  additions. That ADR's marker exists because new lines appear that nobody
  typed; here nothing appears that was not already there — one token is
  swapped for another on a line the user wrote, and CodeMirror's own undo
  already covers it as it would any other edit made by hand.
- [x] The panel closes once the class is changed, rather than trying to
  redraw itself against the new class. The diagram redraw already follows
  the same ~200 ms debounce every mermaid edit does; refreshing the panel
  in step with it would mean re-fetching the node's data mid-render for a
  card whose every relation and metadata section is about to be wrong
  anyway. Closing costs one extra double-click to reopen it on the new
  class, which is the same cost [ADR 0019](0019-select-and-swap-edges.md)
  already accepted for a swap that changes what a selected element is.
- [x] Offered for any class the hierarchy projection has parents, siblings
  or children for, not only `d3f:` — `getParents`/`getChildren`
  (`editor/d3fendHierarchy.js`) already read every loaded vocabulary the
  same way, and the panel already gives a DPV- or legal-only node its own
  heading, so gating the dropdown to D3FEND would be a second, unrelated
  distinction.
- [x] Gated the same way [ADR 0018](0018-add-defensive-measure.md) gates
  the "+": a node the diagram did not write in mermaid gets no dropdown,
  since there is no CURIE token to rewrite.

## Consequences

Pros:

- Retyping a node no longer means finding its class name in the panel and
  the node in the editor separately — the two are now one gesture.
- The rewrite is a pure text function of the document and the two qnames,
  unit-tested without a browser or CodeMirror, the same shape
  [ADR 0018](0018-add-defensive-measure.md) chose for the same reasons.
- Nothing about picking an alternative reaches the RDF store directly; the
  mermaid text is still the only thing that changes
  ([ADR 0011](0011-visualize-markdown-not-mermaid.md)).

Cons:

- A node typed in two vocabularies at once shows two independent
  dropdowns, one per class heading — changing one says nothing about
  whether the other should change too.
- The neighbourhood is one hop: retyping a class two levels away from its
  current one still means picking twice, closing and reopening the panel
  in between.
- Closing the panel loses whatever "Show more" sections the user had
  opened, same trade [ADR 0018](0018-add-defensive-measure.md) already
  made for the "+" buttons, now paid on every class change instead of only
  on the ones the user chooses to expand first.

## DONTREADME

Notes for LLM agents. They are kept out of the sections above because
[ADR 0001](0001-use-adr.md) puts implementation detail outside an ADR.
They describe the code as it is, not the decision, and go stale: check the
code before trusting them.

- `editor/classSwap.js` is the whole rule: `classTokenReplacement(text, anchorId, oldQname, newQname)`. It takes the document text and the two
  qnames and returns `{ from, to, insert }`, or null when the anchor is not
  written in any mermaid block, the two qnames are equal, or `oldQname` is
  not actually a token on the anchor's declaration line. No DOM, no editor
  — same shape as `editor/insertMeasure.js`'s `relationInsertion`.
- `editor/d3fendHierarchy.js`'s `getAlternatives(qname)` is `getParents` +
  `getChildren` + siblings (the other children of each parent, `qname`
  itself excluded), each already deduplicated.
- The anchor is `sourceLocationsFor(index, id)[0]`, same as
  `relationInsertion` — declarations sort ahead of bare mentions.
- `editorPane.insertAt` grew an optional `to` (defaulting to `from`) so the
  same targeted-write primitive covers both an insertion and a replace;
  `changeNodeClass` is the mermaid-aware wrapper around it, next to
  `addRelation`.
- `viz/nodePanel.js`'s `renderClassSwap(qname, host, onChangeClass)` builds
  the `<select>`; it is called once per class heading, both in the
  D3FEND-metadata loop and the term-projection loop for other vocabularies.
- `main.js`'s `nodePanelActions` gates `onChangeClass` behind the same
  `mermaidIdOf` + `hasSource` pair `onAddRelation` uses, and closes
  `nodePanelHost` when the rewrite succeeds.
