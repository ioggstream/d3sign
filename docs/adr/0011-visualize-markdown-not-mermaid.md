# 11. Visualize Markdown, not Mermaid

Date: 2026-07-09

## Status

Accepted

## Context

Given a single markdown file containing multiple mermaid diagrams,
we want to visualize the diagrams in the markdown file,
not the mermaid code.

## Decision

- [ ] The markdown file will not be rendered as HTML.
- [ ] The editor will contain the whole markdown file.
- [ ] The mermaid view will contain a list of all the mermaid diagrams with their title. Title is mandatory. Identifier will be a title hash.
- [ ] If title is duplicated, show a warning.
- [ ] When clicking on a diagram title, the corresponding mermaid diagram will be displayed in the mermaid panel on the right.
- [ ] WRT the RDF graph, the graph will be generated from all the mermaid diagrams in the markdown file.
- [ ] For now, only one markdown file will be supported, but in the future, we may support multiple markdown files.

## Consequences

Pros:

- a whole markdown file can be visualized, not just a single mermaid diagram.

Cons:

- more resources used
- can't modify single mermaid diagrams
- no multiple files support
- mandatory title.
