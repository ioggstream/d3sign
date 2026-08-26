import { describe, it, expect } from 'vitest';
import { matchTermToken } from '../src/editor/d3fendHover.js';

// `name` is the whole qname, not the local name: a term's identity has to say which
// vocabulary it came from now that the editor knows several (editor/vocabularies.js).
describe('matchTermToken', () => {
  it('matches a token at the exact position of the reference', () => {
    const tok = matchTermToken('A -->|d3f:reads| d3f:Vulnerability', 20);
    expect(tok).toEqual({ name: 'd3f:Vulnerability', start: 17, end: 34 });
  });

  it('matches when the position is anywhere inside the token', () => {
    const tok = matchTermToken('d3f:AccessControlList', 3);
    expect(tok.name).toBe('d3f:AccessControlList');
  });

  it('returns undefined when the position is outside any token', () => {
    const tok = matchTermToken('plain text with no reference', 5);
    expect(tok).toBeUndefined();
  });

  it('finds the correct token among several on the same line', () => {
    const line = 'd3f:A -->|d3f:relates| d3f:B';
    expect(matchTermToken(line, 1).name).toBe('d3f:A');
    expect(matchTermToken(line, 24).name).toBe('d3f:B');
  });

  it('matches a dotted ATT&CK id, which D3FEND uses as a term name', () => {
    expect(matchTermToken('X[Thing d3f:AML.T0000]', 12).name).toBe('d3f:AML.T0000');
  });

  it('does not read a prefix out of the middle of a longer word', () => {
    // The pattern is anchored on a non-word, non-colon character, so a prefix that
    // happens to end another identifier is not a term reference.
    expect(matchTermToken('notd3f:Vulnerability', 12)).toBeUndefined();
  });
});
