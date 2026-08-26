import { describe, it, expect } from 'vitest';
import { collectSymbols } from '../src/editor/documentSymbols.js';

const DOC = `# Notes

\`\`\`mermaid
---
title: Layer one
id: one
---
graph TD
  subgraph net [Datacenter d3f:Network]
    S[Server d3f:Server]
  end
  S -->|d3f:reads| DB[(Store d3f:Database)]
\`\`\`

Prose in between.

\`\`\`mermaid
---
title: Layer two
id: two
---
graph LR
  S -->|d3f:writes| LOG[Audit log]
\`\`\`
`;

describe('collectSymbols', () => {
  const symbols = collectSymbols(DOC);

  it('indexes nodes and subgraphs from every diagram', () => {
    expect([...symbols.keys()].sort()).toEqual(['DB', 'LOG', 'S', 'net']);
  });

  it('keeps the d3f: classes as the completion detail', () => {
    expect(symbols.get('S').classes).toEqual(['d3f:Server']);
    expect(symbols.get('net').classes).toEqual(['d3f:Network']);
    expect(symbols.get('DB').classes).toEqual(['d3f:Database']);
  });

  it('records untagged nodes too, with no classes', () => {
    expect(symbols.get('LOG')).toMatchObject({ label: 'Audit log', classes: [] });
  });

  it('carries an id declared in one diagram over to the next', () => {
    expect(symbols.get('S').diagrams).toEqual(['Layer one', 'Layer two']);
  });

  it('unions classes when the same id is tagged in only one block', () => {
    const doc = ['```mermaid', 'graph TD', '  A[Thing d3f:Server]', '```', '', '```mermaid', 'graph TD', '  A --> B', '```'].join('\n');
    expect(collectSymbols(doc).get('A').classes).toEqual(['d3f:Server']);
  });

  it('returns an empty index rather than throwing on a document with no diagrams', () => {
    expect(collectSymbols('just prose').size).toBe(0);
  });
});
