import { describe, it, expect } from 'vitest';
import { nodeCompletionSource } from '../src/editor/nodeCompletion.js';
import { maskLabels } from '../src/editor/mermaidMasking.js';
import { collectSymbols } from '../src/editor/documentSymbols.js';

const DOC = ['```mermaid', 'graph TD', '  Server[Host d3f:Server]', '  Log[Audit log]', '```'].join('\n');
const SYMBOLS = collectSymbols(DOC);

/**
 * Stand-in for CodeMirror's CompletionContext. `state.field` answers with the
 * prebuilt symbol map, which is what `getSymbols` reads.
 */
function fakeContext(text, { explicit = true } = {}) {
  const cursor = text.length;
  return {
    pos: cursor,
    explicit,
    matchBefore(regex) {
      const m = text.slice(0, cursor).match(regex);
      if (!m || !m[0]) return null;
      return { from: cursor - m[0].length, to: cursor, text: m[0] };
    },
    state: {
      field: () => SYMBOLS,
      doc: { sliceString: (from, to) => text.slice(from, to) },
    },
  };
}

describe('nodeCompletionSource', () => {
  it('offers ids declared anywhere in the document', () => {
    const result = nodeCompletionSource(fakeContext('  Ser'));
    expect(result).not.toBeNull();
    expect(result.from).toBe(2);
    expect(result.options.map((o) => o.label).sort()).toEqual(['Log', 'Server']);
  });

  it('shows the original rdf:types in the option detail', () => {
    const { options } = nodeCompletionSource(fakeContext('  Ser'));
    const server = options.find((o) => o.label === 'Server');
    expect(server.detail).toBe('d3f:Server');
    // `infoText`, not CodeMirror's `info`: the popup requires a DOM node from an
    // `info` function and crashes the whole tooltip plugin on a string, so the text
    // lives under our own field and the completion panel renders it.
    expect(server.infoText()).toContain('rdf:type: d3f:Server');
  });

  it('marks an untagged node as such instead of inventing a type', () => {
    const { options } = nodeCompletionSource(fakeContext('  L'));
    expect(options.find((o) => o.label === 'Log').detail).toBe('untagged');
  });

  it('declines a d3f: position, leaving it to the ontology source', () => {
    expect(nodeCompletionSource(fakeContext('  A -->|d3f:'))).toBeNull();
    expect(nodeCompletionSource(fakeContext('  A -->|d3f:re'))).toBeNull();
  });

  it('lists everything when invoked explicitly on an empty prefix', () => {
    const result = nodeCompletionSource(fakeContext('  '));
    expect(result.options).toHaveLength(2);
    expect(result.from).toBe(2);
  });

  it('stays quiet when not invoked explicitly on an empty prefix', () => {
    expect(nodeCompletionSource(fakeContext('  ', { explicit: false }))).toBeNull();
  });
});

describe('maskLabels', () => {
  it('keeps ids and blanks label text', () => {
    expect(maskLabels('  Server[Host d3f:Server]').trim()).toBe('Server');
  });

  it('blanks edge labels but keeps both endpoints', () => {
    expect(maskLabels('  A -->|d3f:reads| B').replace(/\s+/g, ' ').trim()).toBe('A --> B');
  });

  it('blanks comments', () => {
    expect(maskLabels('  A %% Server is here').trim()).toBe('A');
  });

  it('blanks quoted strings', () => {
    expect(maskLabels('  A@{ label: "Server" }').trim()).toBe('A@');
  });
});
