# 18. Add a relation from the node panel

Date: 2026-08-07

## Status

Accepted

## Context

The node info panel already lists, for each `d3f:`
class of a node, the relations D3FEND knows about,
split into Attack, Defense and Relations
([ADR 0008](0008-show-node.md)). Those lists answer
"what would protect this?", "what is it exposed to?"
and "what does the ontology say it takes part in?" —
and they were inert. Adopting one of their rows means
reading the class name off the panel, closing the
modal, finding the node in the mermaid pane and typing
a declaration and a link by hand, with the exact
predicate CURIE.

That is the one place where the ontology already
knows the whole answer. The other end's class, the
predicate and its direction are all in the row that
was just rendered; only the lines of mermaid are
missing.

Writing them is new ground. Every edit so far has
gone from the editor outwards; the only write into
the document is the example switcher replacing it
wholesale. [ADR 0017](0017-go-to-mermaid-source.md)
sent the first thing back from the view to the
editor, but it only scrolls. This one changes the
user's text.

## Decision

- [x] **Every** relation row carries a "+" that writes
  the relation into the diagram: a node declaring the
  D3FEND class at the other end, and the link between
  it and the node being inspected, oriented by the
  relation's own direction. This started as Defense
  rows only, on the grounds that an attack is not a
  component to draw; that was wrong twice over. A
  threat model does draw the technique a node is
  exposed to, and once the panel also lists the
  ontology's plain restrictions
  ([ADR 0008](0008-show-node.md)) — `User d3f:has-account UserAccount` — the rule was
  withholding exactly the rows that describe the
  system being modelled. The class decides which
  section a row appears in; it does not decide whether
  the row is adoptable.
- [x] The lines go directly below where the node is
  declared, at its indentation. A relation written
  next to the node it belongs to reads as a group, and
  a node declared inside a `subgraph` gets its
  addition inside the same container — which is what a
  reader of the diagram would expect, and what the
  graph will then draw ([ADR 0012](0012-fold-container-nodes.md)).
- [x] The addition is preceded by a `%% Added via UI`
  comment line, at the same indentation. The document
  is hand-written text that a tool now also writes
  into, and the reader is entitled to know which is
  which: the marker is what makes an addition findable,
  reviewable in a diff and deletable as a unit. It is
  free in RDF, because the tokenizer strips `%%` to end
  of line, so the marker cannot change the graph.
- [x] The addition goes into the anchor's own block,
  not into a generated block of its own. A separate
  mermaid block with its own `id:` was considered — it
  would be a named graph the Graphs chip could hide and
  a block the user could delete wholesale, and node ids
  are document-wide so the link would still draw. It
  was rejected because the added node would then sit
  outside the anchor's `subgraph`, losing the container
  membership this same ADR goes to trouble to preserve
  ([ADR 0016](0016-nodes-outside-their-container.md)).
  The marker comment gives the traceability the
  separate block was wanted for.
- [x] The generated id is the class local name
  lowercased, with the dots of an ATT&CK id kept as
  underscores (`T1110.001` → `t1110_001`) since
  `ID_RE` has no dot and `t1110001` is not a number
  anybody recognises. It is a name the user will type
  again when they extend the diagram, so it follows the
  convention the examples already use rather than
  being generated to be unique.
- [x] The added node is labelled with the D3FEND label
  of its class, beside the CURIE:
  `t1110_001[d3f:T1110.001 Password Guessing]`. The id
  of an ATT&CK class is a technique number, which is
  precisely what the reader needed translated — a node
  drawn as `t1110_001` says nothing. Labels that would
  close the shape are stripped and parentheses put the
  whole content in the quotes mermaid documents, so a
  CWE title cannot break the diagram.
- [x] A collision suffixes the id rather than reusing
  the node that holds it. Two defences of the same
  kind protecting two artifacts are two measures in
  the modelled system, and merging them silently
  would assert something nobody wrote.
- [x] The panel stays open and the clicked "+"
  becomes a "✓". Adopting one measure is rarely the
  whole intent, and the list is where the next one
  is.
- [x] The button says what it is about to write: the
  label and local name of the class, the predicate and
  which way round the link will read, plus where the
  lines will land. One "Add to the diagram" repeated
  down a list of thirty rows tells the reader nothing
  about the row they are pointing at. Every other
  active control in the panels and in the graph's
  right-click menus carries the same kind of
  explanation, on the same reasoning.
- [x] The insertion point is resolved at click time
  from the editor's live text, by the same scan
  [ADR 0017](0017-go-to-mermaid-source.md) uses. No
  source position reaches the RDF store or the view
  ([ADR 0014](0014-graph-view-from-rdf-only.md)).
- [x] A node the diagram did not write — a `d3f:`
  class, an enrichment resource, an IRI typed into
  the TriG pane — has no "+" on any row. Absence
  rather than an error, as with the source jump.
- [x] The write is a targeted change, not a
  whole-document replacement: one addition is one
  undo step, and the caret and scroll position of the
  pane are left alone.
- [x] The result is ordinary text, immediately
  editable. The marker comment says where it came from,
  but nothing depends on it: no state remembers the
  addition, deleting the comment changes nothing, and
  the "✓" lasts as long as the modal.

Writing mermaid rather than asserting quads is what
keeps the tool a text editor. The document stays the
single source of the diagram
([ADR 0011](0011-visualize-markdown-not-mermaid.md)),
so the addition survives an export, a copy-paste and
a git diff, and it can be corrected with the same
gesture as anything else the user typed. Asserting
the triples into the store instead would draw the
same graph and leave the source silently behind it.

## Consequences

Pros:

- The ontology stops being reference material and
  becomes an editing affordance: the panel that
  explains what would protect a node can now add it.
- The predicate and the direction are taken from
  D3FEND, so the link that most often carries a typo
  when hand-written cannot carry one here.
- The text-generation is a pure function of the
  document, so it is unit-tested without a browser or
  CodeMirror.
- The editor gained a targeted write, which is what
  any future authoring gesture needs.

Cons:

- The diagram can grow faster than it is read, and
  more so now that every row is addable: a few clicks
  add nodes the user did not lay out, and an addition
  inserted into a `subgraph` joins that container
  whether or not it belongs to it.
- An addition of an Attack row draws an ATT&CK
  technique as a node of the modelled system. The
  drawing does mark it — offensive techniques are red
  ([ADR 0015](0015-graph-visualization-preferences.md))
  — but the text does not: nothing in the mermaid says
  which section a row came from, only which class it
  was.
- The generated node carries the class and the
  ontology's label for it, but no id or name chosen for
  the system being modelled. It is a starting point
  that usually wants renaming — and the label it starts
  with is generic (`User Account`, not `Alice's account`).
- Nothing detects that the same relation is already
  drawn: the suffixed id is deliberate, but a user
  clicking twice gets two of them. This matters more
  now that the addable rows include the restrictions a
  diagram is most likely to have drawn already, and it
  is not addressed here — answering it means asking the
  RDF store what is already on the other end of that
  predicate, which is a different feature from writing
  text.

## DONTREADME

Notes for LLM agents. They are kept out of the
sections above because [ADR 0001](0001-use-adr.md)
puts implementation detail outside an ADR. They
describe the code as it is, not the decision, and go
stale: check the code before trusting them.

- `editor/insertMeasure.js` is the whole rule:
  `relationInsertion(text, anchorId, rel)` plus
  `relationNodeId` and the `ADDED_MARKER` constant. It
  takes the document text and a `relations` entry of
  `data/d3fend-metadata.json` — any `kind` — and returns
  `{ from, insert }`, or null when the anchor is not
  written in any mermaid block. No DOM, no editor. The
  file name still says `Measure`; the exports were
  renamed when attack and restriction rows became
  addable and the file was not.
- `nodePanel.js` imports `ADDED_MARKER` — the one thing
  it takes from the editor layer — so the "+" tooltip
  and the inserted comment cannot disagree about the
  wording. Nothing else about the insertion is visible
  to the panel.
- The anchor is `sourceLocationsFor(index, id)[0]`,
  which already sorts declarations ahead of bare
  mentions. An id that only ever appears on an edge
  still gets an insertion, below that edge.
- The taken ids are the keys of the location index,
  which is every id written in the document, not per
  block — id identity is document-wide
  ([ADR 0003](0003-diagram-to-trig.md)).
- `relations[].direction` is read from the inspected
  node's side: `in` means the other end acts on it, so
  the added node is the arrow's source.
- The id charset is the parser's `ID_RE`. ATT&CK
  local names carry a `.`, which it does not accept, so
  a dot becomes `_` and anything else outside the
  charset is dropped: `T1548.001` becomes the id
  `t1548_001`. The shape content is
  `relationNodeContent`, which is the full CURIE plus
  the class's `label` from the metadata (omitted when it
  only repeats the local name, as for `d3f:Email`), and
  `nodeParser.js`'s
  `CLASS_TOKEN_RE` had to learn dotted local names for
  that to type the node as the sub-technique rather
  than as `d3f:T1548` with a `.001` label — a bug that
  could not fire while attack rows had no "+".
- `editorPane.insertAt` is the generic targeted
  write; `addRelation` is the mermaid-aware wrapper.
  Both report through the usual 200 ms debounce, so
  the graph and the TriG pane follow without new
  plumbing.
- The panel is handed `onAddRelation` by `main.js`;
  `main.js` decides whether there is anything to add
  with the same `mermaidIdOf` + `hasSource` pair as the
  source jump.
- Menu tooltips are a `description` per item in
  `viz/nodeMenu.js`, rendered as the button's `title`
  by `viz/graphPane.js`. `node-menu.test.js` asserts
  every item has one.
- The "✓" is set on the button in place. Re-rendering
  the panel would be simpler but rebuilds the whole
  modal, closing every "Show more" the user opened.
