# 2. Client-side SPA stack for the D3FEND graph editor

Date: 2026-07-25

## Status

Accepted

## Context

README.md describes three capabilities:

- parse a mermaid+d3fend-annotated
  diagram into an RDF/turtle graph,
- visualize that graph, and filter/redirect
  the visualization (including inverse-property viewing and enrichment with
  external data).
- The human-authoring interface
  MUST be strictly textual — a code editor, never a visual/drag-and-drop
  diagram builder; the visual pane is for viewing and filtering only.

## Decision

- [x] Build a single-page application, `app/`, that runs entirely client-side
  with no backend — a static site.
- [x] Use CodeMirror 6 as the only authoring surface for the mermaid+d3fend
  source text.
- [x] Use N3.js as the in-memory RDF store, turtle serializer, and turtle
  parser (also used to load enrichment data).
- [x] Use Cytoscape.js, not mermaid, for the interactive filtered graph view,
  since mermaid re-renders a whole static diagram from source text and has no
  concept of toggling per-predicate visibility or flipping edge direction.
  Mermaid itself is still used for a separate, read-only source-preview pane.
- [x] Use Vite as the build tool, producing a static `app/dist/` deployable
  as plain files.

## Consequences

Pros:

- No server/runtime dependency; the app can be hosted anywhere static files
  are served.
- Cytoscape driven directly by RDF triples makes predicate filtering and
  inverse-direction toggling straightforward and reactive.
- The mermaid preview pane reuses a rendering and
  icon-registration approach already proven in this
  repo, rather than inventing one.

Cons:

- Two separate diagram representations (mermaid's own render tree and our
  RDF-derived Cytoscape graph) must be kept structurally consistent by the
  parser; they are not the same code path.
- No server means no multi-user persistence: anything
  the user selects or arranges is per-browser.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- The preview's rendering and icon registration come
  from `diagrams/template.html`, which predates
  `app/` and is still at repo root.
- Per-browser state is `localStorage`. The keys are
  introduced by the ADRs that added the state they
  hold: filters and fold state
  ([ADR 0012](0012-fold-container-nodes.md)) and
  `d3fend-graph:view-prefs`
  ([ADR 0015](0015-graph-visualization-preferences.md)).
