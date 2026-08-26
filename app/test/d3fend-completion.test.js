import { describe, it, expect } from 'vitest';
import { d3fendCompletionSource, D3F_PREFIX } from '../src/editor/d3fendCompletion.js';

// Minimal stand-in for CodeMirror's CompletionContext — only exercises
// `matchBefore`, which is all d3fendCompletionSource depends on.
function fakeContext(text, cursor = text.length) {
  return {
    matchBefore(regex) {
      const before = text.slice(0, cursor);
      const m = before.match(regex);
      if (!m) return null;
      return { from: cursor - m[0].length, to: cursor, text: m[0] };
    },
  };
}

describe('d3fendCompletionSource', () => {
  it('triggers right after a bare "d3f:" prefix', () => {
    const result = d3fendCompletionSource(fakeContext('A --hardens--> d3f:'));
    expect(result).not.toBeNull();
    expect(result.from).toBe(15);
    expect(Array.isArray(result.options)).toBe(true);
  });

  it('triggers with a partial class name typed after "d3f:"', () => {
    const result = d3fendCompletionSource(fakeContext('d3f:Vuln'));
    expect(result).not.toBeNull();
    expect(result.from).toBe(0);
  });

  it('does not trigger when the cursor is not after "d3f:"', () => {
    const result = d3fendCompletionSource(fakeContext('just plain text'));
    expect(result).toBeNull();
  });

  it('does not trigger mid-identifier once whitespace breaks the prefix', () => {
    const result = d3fendCompletionSource(fakeContext('d3f:Vuln erability'));
    expect(result).toBeNull();
  });

  it('exposes the prefix regex used for validFor', () => {
    expect('d3f:Foo').toMatch(D3F_PREFIX);
    expect('no prefix here').not.toMatch(D3F_PREFIX);
  });

  it('completes a dotted ATT&CK id, which D3FEND uses as a term name', () => {
    expect('d3f:AML.T0000').toMatch(D3F_PREFIX);
    const result = d3fendCompletionSource(fakeContext('d3f:AML.'));
    expect(result).not.toBeNull();
    expect(result.options.some((option) => option.label === 'd3f:AML.T0000')).toBe(true);
  });

  // CodeMirror's own `info` field is a trap for this data: from a function it
  // accepts only a DOM node, and the string ours returned threw inside the
  // completion popup. The throw crashed the tooltip plugin, which CodeMirror
  // deactivates on a crash — so one completion killed the popup *and* every hover
  // card until the page was reloaded. The text lives under `infoText`, which the
  // library never reads and completionPanel.js renders.
  it('carries its documentation as lazy text under infoText, never as info', () => {
    const [option] = d3fendCompletionSource(fakeContext('d3f:Password')).options;
    expect(option.info).toBeUndefined();
    expect(typeof option.infoText).toBe('function');
    expect(typeof option.infoText()).toBe('string');
  });

  it('offers one section per vocabulary, D3FEND first', () => {
    // Ranking is what keeps `d3f:` above the legal vocabularies, which in turn sit
    // below the document's own node ids (nodeCompletion.js).
    const options = d3fendCompletionSource(fakeContext('d3f:')).options;
    expect(new Set(options.map((option) => option.section.name))).toEqual(
      new Set(['D3FEND ontology']),
    );
    expect(options[0].section.rank).toBe(2);
  });
});
