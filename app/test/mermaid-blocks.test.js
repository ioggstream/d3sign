import { describe, it, expect } from 'vitest';
import { mermaidBlockLines, mermaidLineKind } from '../src/editor/mermaidBlocks.js';

describe('mermaidBlockLines', () => {
  it('finds every block, inclusive of its fence lines', () => {
    const text = [
      '# Title', // 1
      '', // 2
      '```mermaid', // 3
      'graph TD', // 4
      '  A[App d3f:Application]', // 5
      '```', // 6
      '', // 7
      'Some prose.', // 8
      '', // 9
      '```mermaid', // 10
      'graph LR', // 11
      '```', // 12
    ].join('\n');

    expect(mermaidBlockLines(text)).toEqual([
      { fromLine: 3, toLine: 6 },
      { fromLine: 10, toLine: 12 },
    ]);
  });

  it('ignores fenced blocks of other languages', () => {
    const text = ['```js', 'const a = 1;', '```'].join('\n');
    expect(mermaidBlockLines(text)).toEqual([]);
  });

  it('runs an unterminated block to the end of the document', () => {
    const text = ['```mermaid', 'graph TD', '  A --> B'].join('\n');
    expect(mermaidBlockLines(text)).toEqual([{ fromLine: 1, toLine: 3 }]);
  });

  it('returns no blocks for a document without mermaid', () => {
    expect(mermaidBlockLines('just prose\nover two lines')).toEqual([]);
  });
});

describe('mermaidLineKind', () => {
  const blocks = [{ fromLine: 3, toLine: 6 }];

  it('marks the fence lines and the body separately', () => {
    expect(mermaidLineKind(blocks, 3)).toBe('fence');
    expect(mermaidLineKind(blocks, 6)).toBe('fence');
    expect(mermaidLineKind(blocks, 4)).toBe('body');
    expect(mermaidLineKind(blocks, 5)).toBe('body');
  });

  it('returns null outside every block', () => {
    expect(mermaidLineKind(blocks, 2)).toBeNull();
    expect(mermaidLineKind(blocks, 7)).toBeNull();
  });
});
