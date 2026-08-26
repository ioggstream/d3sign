# D3FEND RDF Graph

This project does 3 things:

1. given a mermaid diagram annotated with d3fend properties,
   it generates an RDF graph in turtle format;
   examples are in the [app/src/data/examples](app/src/data/examples) folder,
   and are selectable from the app's header dropdown

1. the RDF graph can be visualized as a diagram, there's no specific
   requirement on the libraries to use to visualize it

   the visualization is built from the RDF graph alone — mermaid is only the
   input of step 1, so any turtle/trig in the store renders, whether or not a
   diagram produced it (see
   [docs/adr/0014-graph-view-from-rdf-only.md](docs/adr/0014-graph-view-from-rdf-only.md))

1. the visualization can show specific properties or all properties,
   for example, to show only specific traffic flows (read, write, etc.)

   1. relationships can be viewed in different directions, for example
      A d3f:reads B
      B d3f:read-by A
   1. specific visualizations may be saved using inverse properties to
      define directions
   1. the RDF graph can be enriched with additional information,
      eg, well-known authentication flows.

## App

A single-page application implementing all three features lives in
[app/](app/). It runs fully client-side (no backend), in three columns. Each
column is a tab group and every view can live in any of them: `Alt+Shift+←` and
`Alt+Shift+→` move the selected view one column over, the arrangement and the
column widths are remembered across reloads, and `Reset layout` in the header
puts everything back
([docs/adr/0022-column-tab-groups.md](docs/adr/0022-column-tab-groups.md)). The
views are: a text-only editor (CodeMirror) for the mermaid+d3fend source, a
`Files` pane (`Alt+F`) holding documents stored in the browser — the one being
edited is saved as you type and comes back on reload, `Save as…` keeps a named
copy, and files can be downloaded to disk or imported from it
([docs/adr/0023-browser-local-file-store.md](docs/adr/0023-browser-local-file-store.md)),
an
editable TriG pane holding the whole RDF document (hand-edits drive the graph;
`Alt+,` moves it between its own column and a tab beside the graph — see
[docs/adr/0009-direct-rdf-import.md](docs/adr/0009-direct-rdf-import.md)), and
the interactive **D3FEND Graph** — a Cytoscape.js view with per-predicate
filtering and inverse-direction toggling. Its header also carries a layout
algorithm dropdown, two 90° rotate buttons, and a `View` chip holding the
visualization preferences: node spacing, node size, label size, link labels,
the text size of the info panels, and whether nodes are drawn as coloured dots or as
[D3FEND icons](https://github.com/ioggstream/d3fend-icons). Nodes are coloured by
their D3FENDCore branch, except offensive techniques, which are red in both modes —
D3FEND puts an ATT&CK technique on the same branch as the countermeasure against it
([docs/adr/0015-graph-visualization-preferences.md](docs/adr/0015-graph-visualization-preferences.md)).
One more preference there, off by default, reads a diagram that reifies its
messages as message passing: an artifact whose whole presence in the graph is one
producing link in and one consuming link out — an HTTP request, a database query,
a binlog — is not drawn, and the path through it becomes a single dotted arrow
between the two parties carrying the artifact's name. Double-clicking that arrow
names both triples it stands for, and `g` walks to both mermaid lines. Like
folding, it never changes the RDF
([docs/adr/0026-collapse-artifact-mediated-paths.md](docs/adr/0026-collapse-artifact-mediated-paths.md)).
A container node — one that `d3f:contains` others — holds exactly what it
contains: whichever layout is running, a node that is not inside it is never
drawn inside or across its border
([docs/adr/0016-nodes-outside-their-container.md](docs/adr/0016-nodes-outside-their-container.md)).
Right-clicking one offers to fold it into a single node standing for its whole
subtree, with its children's outside links redrawn as dashed links on the
container itself. Clicking a node selects it — the graph header then names it,
`f` folds or unfolds it and `g` jumps to its mermaid source — and double-clicking
it opens its information panel. Clicking a link selects it the same way: `s` then
swaps which way it is drawn, renaming the predicate to its inverse, `g` jumps to
the mermaid line that wrote it, and double-clicking opens what it asserts —
including, on a link inherited from a folded container, the links it stands for.
Every one of those is also an item on the right-click menu, which names the
shortcut beside it. Neither folding nor swapping changes the RDF, only the view
([docs/adr/0012-fold-container-nodes.md](docs/adr/0012-fold-container-nodes.md),
[docs/adr/0008-show-node.md](docs/adr/0008-show-node.md),
[docs/adr/0019-select-and-swap-edges.md](docs/adr/0019-select-and-swap-edges.md)).
In that panel, every relation D3FEND lists for the node — an attack, a defensive
measure, or a plain restriction such as `d3f:has-account` — carries a `+` that
writes it into the diagram: a node for the class at the other end — labelled with
the class and D3FEND's name for it, e.g.
`t1110_001[d3f:T1110.001 Password Guessing]` — and the link tying it to this node,
below where the node is declared and under an `%% Added via UI` comment
([docs/adr/0018-add-defensive-measure.md](docs/adr/0018-add-defensive-measure.md)).
The mermaid preview and the graph start as tabs of the third column, reachable
with `Alt+M` and `Alt+G` (`Alt+E` for the source editor), and while the graph is
on screen `Alt+T`, `Alt+N`, `Alt+L` and `Alt+V`
open the named-graph filter, the node-kind filter, the link-kind filter and the
preferences from the keyboard — each chip prints its own chord (in the
searchable filters, type to narrow, `Enter` toggles the listed ones, `Escape`
cancels)
([docs/adr/0013-graph-view-controls.md](docs/adr/0013-graph-view-controls.md)).
Another view, **SPARQL** (`Alt+Q`), queries the RDF document and the D3FEND
ontology together, so questions the precomputed lookups cannot answer —
transitive hardening through `rdfs:subClassOf*`, which artifacts have *no*
measure, which `d3f:` class in the diagram does not exist — become queries. The
pane holds a query editor over a results table, with a library of canned queries
in its dropdown, and a `Sources` chip (`Alt+K`) listing the knowledge bases the
engine holds: a knowledge base is queryable but never serialized into the TriG
pane and never drawn, which is what keeps ~130k ontology triples out of
CodeMirror and Cytoscape. Typing runs nothing; `Ctrl+Enter` does. In the results,
a row naming a node the graph is drawing can reveal it there, and a `CONSTRUCT`
result can be added to the document as its own named graph — at which point the
Graphs chip, the TriG pane and the drawing all pick it up for free. `q` on a
selected node opens the pane with that node bound to `?this`
([docs/adr/0020-sparql-query-engine.md](docs/adr/0020-sparql-query-engine.md),
[docs/adr/0021-sparql-query-pane.md](docs/adr/0021-sparql-query-pane.md)).
See [docs/adr/0002-client-side-spa-stack.md](docs/adr/0002-client-side-spa-stack.md)
and [docs/adr/0003-dedicated-parser-and-named-graphs.md](docs/adr/0003-dedicated-parser-and-named-graphs.md)
for the design decisions.

To run it:

```sh
cd app
npm install
npm run dev
```

### The D3FEND ontology file

`app/public/kg/d3fend.ttl.gz` is committed, so the SPARQL pane works on a fresh
clone. To regenerate it from a newer `d3fend.ttl` (the same file
[app/scripts/](app/scripts/) take to rebuild the JSON projections):

```sh
gzip -9 -c /path/to/d3fend.ttl > app/public/kg/d3fend.ttl.gz
```

Every JSON projection reads the gzipped copy directly, so they can all be rebuilt
from the committed file alone — see
[Rebuilding the data files](#rebuilding-the-data-files).

It is fetched lazily — nothing downloads until the SPARQL tab is opened or a
Source is ticked — and costs ~400 KB on the wire rather than 3.6 MB. Whether the
browser or the worker inflates it depends on whether the host sends
`Content-Encoding: gzip` (Vite's dev server does), so the loader sniffs the gzip
magic number rather than assuming either. Without the file, document-only queries
still work and ticking `D3FEND ontology` says what is missing and how to make it.

On load, the worker also flattens the ontology's `owl:Restriction` relations into
direct triples — D3FEND states many relations *only* that way — and the Sources
chip reports how many it added. Queries can then all read
`?measure d3f:hardens ?artifact` without knowing about restrictions.

Adding another knowledge base is three steps and no code change beyond the
manifest: drop the turtle in `app/public/kg/`, add an entry to
[app/src/rdf/knowledgeBases.js](app/src/rdf/knowledgeBases.js), and write `.rq`
files under [app/src/data/queries/](app/src/data/queries/) carrying
`# needs: <id>`. Two rules the entries follow: everything a SPARQL property path
has to walk ships in **one** named graph — a path is evaluated inside one `GRAPH`
binding, so a hierarchy split across two graphs is silently truncated — and a
base's vocabulary prefixes belong in
[queryPrefixes.js](app/src/query/queryPrefixes.js), not on the entry, so a query
does not parse or fail depending on which Sources are ticked.

### The legal knowledge bases

Two more Sources answer *which NIS2 or GDPR duty does this control discharge, and
which duties has nothing been drawn for*
([docs/adr/0025-legal-knowledge-bases.md](docs/adr/0025-legal-knowledge-bases.md)):

- **EU legal vocabularies (DPV)** — `app/public/kg/legal.ttl.gz`, W3C's Data
  Privacy Vocabulary 2.3 with its personal-data (`pd`), `risk` and `tech` modules
  and the EU GDPR, NIS2 and AI Act extensions, © the W3C DPV CG under CC-BY-4.0.
  The seven modules are concatenated verbatim, ~165 KB on the wire.
- **Obligations and D3FEND alignment** —
  [app/public/kg/regulation.ttl](app/public/kg/regulation.ttl), hand-authored and
  plain so a claim is reviewable in a diff. DPV has no catalogue of the NIS2
  Article 21(2) measures, so the obligations are transcribed there, together with
  the mappings that tie a `d3f:` class to them. Every mapping carries a mandatory
  rationale and a strength, and ships as `al:Draft` — it is engineering judgement,
  not legal advice.

The DPV file is generated and committed, as are the JSON projections built from
it — see [Rebuilding the data files](#rebuilding-the-data-files).

Six queries use them: coverage of the document, the gaps, the duties one selected
node speaks to, the measure mix by DPV family, the measures the alignment says
nothing about, and a CONSTRUCT that draws the obligations beside the architecture.

### Writing a diagram in DPV

A diagram is not limited to `d3f:`. Four prefixes may type a node and label an
edge — `d3f:`, `dpv:`, `pd:` and `eu-gdpr:` — so the architecture and the privacy
facts annotate the same boxes
([docs/adr/0028-support-data-privacy-vocabulary.md](docs/adr/0028-support-data-privacy-vocabulary.md)).
[gdpr-signup.md](app/src/data/examples/gdpr-signup.md) is the worked example:

```mermaid
DB[(Customer records d3f:Database dpv:PersonalData)]
ACME[Acme Ltd dpv:DataController] -->|dpv:hasDataSubject| USER((Applicant eu-gdpr:DataSubject))
```

The prefix labels are upstream's own, so a term pasted out of the DPV
documentation resolves as written: `eu-gdpr:`, not `gdpr:`.

The other vocabularies the editor knows — `risk:`, `tech:`, `eu-nis2:`,
`eu-aiact:`, `ob:`, `al:` — stay completable and hoverable but are **never**
types. They record a judgement about a system rather than a thing in it, and
since a writable prefix is consumed anywhere in a node's text, a writable `risk:`
would silently strip the label from `A[Cache risk:high]`.

Two consequences worth knowing. DPV nodes are coloured by family, with Entity and
Data taking the same colour and filter bucket as D3FEND's Agent and Artifact,
because they are the same concepts in another vocabulary; the rest share a `legal`
bucket. And the DPV relations are their own `privacy` link kind, so the Links
filter can show the personal-data story on its own — they are deliberately not
data flow, since they say what a node is associated with, not that anything
crosses the link.

A category of personal data is a *subclass* of `dpv:PersonalData`, so it goes on
the node (`pd:MedicalHealth`). There is no `dpv:hasPersonalDataCategory`.

### Rebuilding the data files

`app/src/data/` holds six generated JSON projections, all committed so a fresh
clone works. One script rebuilds them:

```sh
bash app/scripts/rebuild-data.sh
```

That runs offline against the committed knowledge bases and is idempotent — a
second run leaves `git diff` empty. Two flags:

- `--fetch-dpv <tag>` also refetches DPV from `w3c/dpv` and rebuilds
  `legal.ttl.gz`. Pass a tag; the default `master` is mutable, so two builds a
  week apart can differ while claiming the same provenance, and the script warns.
  `build-legal-kg.py --source-dir` reads a local checkout instead.
- `--d3fend <path>` builds the D3FEND projections from a newer `d3fend.ttl`
  rather than the committed gzip.

The projections exist because completion, hover, node colour and the node panel
all run synchronously on a keystroke or a click, and cannot wait for the query
worker to fetch and parse 30 000 triples
([docs/adr/0020-sparql-query-engine.md](docs/adr/0020-sparql-query-engine.md)).

## Limitations

- Only the mermaid graph/flowchart syntax style is supported.

- Only tagged nodes are parsed (e.g., `U[User d3f:Actor]`), where a tag is a term
  in one of the four writable vocabularies — `d3f:`, `dpv:`, `pd:`, `eu-gdpr:`. A
  term in any other vocabulary the editor knows is left in the label.

- Only `|` tagged edge labels are parsed (e.g., `A -->|d3f:reads| B`). The prefix is
  required: `|reads|` emits nothing and the warning banner names the label. It used
  to be read as `d3f:reads`, which could not tell a shorthand for a real property
  from prose between the pipes — `|a|` became the nonexistent `d3f:a` the same way.
  The endpoints are still declared; only the relation is dropped.

- The arrow head is presentation: `-->`, `--o` and `--x` yield the same triple. A
  head at each end (`<-->`, `o--o`, `x--x`) yields one triple per direction — and
  the graph draws the pair back as a single link with a head at each end
  ([docs/adr/0024-two-way-links.md](docs/adr/0024-two-way-links.md)).

- Mermaid has no back arrow — `<--`, `o--` and `x--` only open a link that a head
  on the right has to close. Such a line renders nowhere, so it emits nothing,
  the warning banner names the arrow and the editor underlines it in red.

- Arrows may be chained on one line: `A -->|d3f:reads| B -->|d3f:writes| C` is two
  edges, one per arrow (the `edge-forms` case in
  [testcases.md](app/src/data/examples/testcases.md)).

- Unlabeled links are ignored (e.g., `A --> B`).

- Labels not using the `|` syntax are ignored (e.g., `A --text between dashes--> B`).

- Untagged link labels are ignored (e.g., `A -->|reads| B`).

- Untagged nodes are ignored (e.g., `A[Node]`).
