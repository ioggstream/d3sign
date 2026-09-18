import { describe, it, expect } from 'vitest';
import { classTokenReplacement } from '../src/editor/classSwap.js';

const doc = (...lines) => ['```mermaid', 'graph TD', ...lines, '```'].join('\n');

/** The document as the editor would hold it once the change is applied. */
function applied(text, change) {
  expect(change).not.toBeNull();
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}

describe('classTokenReplacement', () => {
  it('replaces the class token on the node\'s declaration line', () => {
    const text = doc('n1[d3f:Password Password]');
    const change = classTokenReplacement(text, 'n1', 'd3f:Password', 'd3f:Credential');
    expect(applied(text, change)).toBe(doc('n1[d3f:Credential Password]'));
  });

  it('leaves the rest of the label untouched', () => {
    const text = doc('n1[d3f:Password My Password]');
    const change = classTokenReplacement(text, 'n1', 'd3f:Password', 'd3f:Credential');
    expect(applied(text, change)).toBe(doc('n1[d3f:Credential My Password]'));
  });

  it('replaces only the matching occurrence among several class tokens', () => {
    const text = doc('n1[d3f:User d3f:Software]');
    const change = classTokenReplacement(text, 'n1', 'd3f:Software', 'd3f:Firmware');
    expect(applied(text, change)).toBe(doc('n1[d3f:User d3f:Firmware]'));
  });

  it('returns null when the anchor is not written in any mermaid block', () => {
    const text = doc('n1[d3f:Password Password]');
    expect(classTokenReplacement(text, 'nope', 'd3f:Password', 'd3f:Credential')).toBeNull();
  });

  it('returns null when the old token is not on the declaration line', () => {
    const text = doc('n1[d3f:Password Password]');
    expect(classTokenReplacement(text, 'n1', 'd3f:Credential', 'd3f:Password')).toBeNull();
  });

  it('returns null when the two qnames are equal', () => {
    const text = doc('n1[d3f:Password Password]');
    expect(classTokenReplacement(text, 'n1', 'd3f:Password', 'd3f:Password')).toBeNull();
  });

  it('returns null when either qname is missing', () => {
    const text = doc('n1[d3f:Password Password]');
    expect(classTokenReplacement(text, 'n1', '', 'd3f:Credential')).toBeNull();
    expect(classTokenReplacement(text, 'n1', 'd3f:Password', '')).toBeNull();
  });
});
