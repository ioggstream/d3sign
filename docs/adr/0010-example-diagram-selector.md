# 10. Example diagram selector

Date: 2026-07-28

## Status

Accepted

## Context

The editor's initial content was a diagram hardcoded
as a string literal in the app's entry point.
Separately, a set of example diagrams lived in a
`diagrams/` directory at repo root, used to render
standalone HTML previews, but outside `app/` and
therefore not servable or bundleable by the build.
Users need a way to pick from several example diagrams
without leaving the SPA.

## Decision

- [x] Move the example diagrams inside `app/`, so they
  are bundled with the app instead of fetched
  separately.
- [x] Load them as build-time raw text imports, the
  same static-asset-as-text pattern already used for
  the enrichment Turtle file, rather than introducing
  a runtime fetch from a served directory.
- [x] Expose the example picker as a select control in
  the header, reusing the editor's existing
  set-content API — no new editor surface.
- [x] Derive each option's label from the diagram's `title:` frontmatter,
  falling back to the filename when absent.
- [x] The standalone HTML export flow stays at repo
  root, unaffected.

## Consequences

Pros:

- Examples are bundled at build time; no extra network
  request and no served-directory convention
  introduced.
- Reuses existing patterns, keeping the change small.

Cons:

- A new example must be added inside `app/` to be
  picked up by the app. The standalone export flow
  keeps its own copies at repo root, so the two are
  not automatically kept in sync.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- Examples are `app/src/data/examples/*.md`, loaded
  with `import.meta.glob(..., { query: '?raw' })` —
  the same pattern as the enrichment Turtle.
- The picker is a `<select>` in the header driving the
  editor's `setText`.
- The hardcoded initial diagram used to be a string
  literal in `main.js`.
- The standalone flow is `diagrams/template.html`,
  which also supplies the mermaid preview's
  icon-registration approach
  ([ADR 0002](0002-client-side-spa-stack.md)).
