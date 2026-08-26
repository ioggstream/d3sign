import { describe, it, expect } from 'vitest';
import { backArrowSpans, looksLikeEdgeLine } from '../src/parser/edgeParser.js';
import { isBackArrow, isBidirectional } from '../src/parser/linkGrammar.js';

// The link grammar is shared by three consumers that have to agree: the edge
// parser, the mask that blanks arrows before ids are read, and the editor
// decoration that paints a broken line red (editor/linkErrors.js). The
// decoration is not tested through CodeMirror — the offsets it draws with come
// from `backArrowSpans`, which is a pure function of the line.

describe('isBackArrow / isBidirectional', () => {
  it.each(['<--', 'o--', 'x--', '<-.-', '<---'])('reads `%s` as a back arrow', (link) => {
    expect(isBackArrow(link)).toBe(true);
    expect(isBidirectional(link)).toBe(false);
  });

  it.each(['-->', '--o', '--x', '-.->', '---'])('reads `%s` as a forward link', (link) => {
    expect(isBackArrow(link)).toBe(false);
    expect(isBidirectional(link)).toBe(false);
  });

  it.each(['<-->', 'o--o', 'x--x', 'o--x', '<-.->'])('reads `%s` as bidirectional', (link) => {
    expect(isBackArrow(link)).toBe(false);
    expect(isBidirectional(link)).toBe(true);
  });
});

describe('backArrowSpans', () => {
  it('points at the arrow as written', () => {
    const line = '  c o--|d3f:reads| d';
    expect(backArrowSpans(line)).toEqual([{ arrow: 'o--', from: 4, to: 7 }]);
    expect(line.slice(4, 7)).toBe('o--');
  });

  it('finds every back arrow on a chained line', () => {
    expect(backArrowSpans('a <--|p| b x--|q| c').map((s) => s.arrow)).toEqual(['<--', 'x--']);
  });

  it('finds an unlabelled back arrow too — it does not render either', () => {
    expect(backArrowSpans('a <-- b').map((s) => s.arrow)).toEqual(['<--']);
  });

  it.each([
    'a -->|d3f:reads| b',
    'a --o|d3f:reads| b',
    'a --x|d3f:reads| b',
    'a <-->|d3f:related| b',
    'a o--o|d3f:related| b',
    'a -.->|d3f:reads| b',
    'dc-1-net --> repo',
  ])('says nothing about `%s`', (line) => {
    expect(backArrowSpans(line)).toEqual([]);
  });

  it.each([
    'a -->|see <-- there| b',
    'a["arrow <-- in a label"] --> b',
    'a --> b %% write it as a <-- b',
  ])('ignores an arrow that is display text: `%s`', (line) => {
    expect(backArrowSpans(line)).toEqual([]);
  });
});

describe('looksLikeEdgeLine', () => {
  it.each(['a -->|p| b', 'a --o|p| b', 'a --x|p| b', 'a -.->|p| b', 'a <--|p| b', 'a o-- b'])(
    'classifies `%s` as an edge line',
    (line) => {
      expect(looksLikeEdgeLine(line)).toBe(true);
    },
  );

  it.each(['a[Host d3f:Host]', 'subgraph net[d3f:Network]', 'dc-1-net'])(
    'leaves `%s` to the node parser',
    (line) => {
      expect(looksLikeEdgeLine(line)).toBe(false);
    },
  );
});
