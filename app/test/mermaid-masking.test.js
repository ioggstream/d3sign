import { describe, it, expect } from 'vitest';
import {
  maskLinkOperators,
  maskMermaidLine,
  maskStyleSuffix,
} from '../src/editor/mermaidMasking.js';

/** Every mask must be length-preserving, or every offset built on it is wrong. */
function expectSameLength(fn, line) {
  expect(fn(line)).toHaveLength(line.length);
}

describe('maskStyleSuffix', () => {
  it('blanks the style name so it is not read as an id', () => {
    expect(maskStyleSuffix('A[Host]:::net')).toBe('A[Host]      ');
  });

  it('preserves length', () => {
    expectSameLength(maskStyleSuffix, '  A[Host]:::net');
  });
});

describe('maskLinkOperators', () => {
  it('blanks an arrow written without spaces', () => {
    expect(maskLinkOperators('port-->p2')).toBe('port   p2');
  });

  it.each(['A-->B', 'A---B', 'A-.->B', 'A==>B', 'A~~~B', 'A<-->B', 'A--oB', 'A--xB'])(
    'blanks the link in %s',
    (line) => {
      expect(maskLinkOperators(line).trim().split(/\s+/)).toEqual(['A', 'B']);
    },
  );

  it('leaves single hyphens alone — they are legal id characters', () => {
    expect(maskLinkOperators('dc-1-net')).toBe('dc-1-net');
  });

  it('blanks a head on the left too, so it is not read as an id', () => {
    expect(maskLinkOperators('c o--|p| d')).toBe('c    |p| d');
  });

  it('leaves an id ending in o or x alone — the head has to be a word of its own', () => {
    // `repo-->` is `repo` and `-->`. The lookbehind in linkGrammar.js is what
    // keeps the `o` where it belongs.
    expect(maskLinkOperators('repo-->p2')).toBe('repo   p2');
    expect(maskLinkOperators('linux--x p2')).toBe('linux    p2');
  });

  it('preserves length', () => {
    expectSameLength(maskLinkOperators, '  port-->|d3f:used-by| p2');
  });
});

describe('maskMermaidLine', () => {
  // The bug this whole module exists for: `-` is in ID_RE, so an unmasked
  // `port-->` tokenizes as `port--` and the id `port` is never seen.
  it('exposes both endpoints of a spaceless labelled edge', () => {
    const masked = maskMermaidLine('    port-->|d3f:used-by| p2');
    expect(masked).toHaveLength('    port-->|d3f:used-by| p2'.length);
    expect(masked.trim().split(/\s+/)).toEqual(['port', 'p2']);
  });

  it('hides label text, edge predicates and style names together', () => {
    expect(maskMermaidLine('  S[Server]:::net').trim()).toBe('S');
  });
});
