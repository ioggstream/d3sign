import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// The module reads localStorage at call time; the test runner is plain node, so
// stub it before importing (a static import would hoist above the assignment).
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};

let loadVisibleGraphs;
let saveVisibleGraphs;
let graphMatchesQuery;

beforeAll(async () => {
  ({ loadVisibleGraphs, saveVisibleGraphs, graphMatchesQuery } = await import('../src/viz/graphVisibility.js'));
});

beforeEach(() => stored.clear());

const A = 'urn:d3fend-graph:a';
const B = 'urn:d3fend-graph:b';
const C = 'urn:d3fend-graph:c';

describe('graph visibility is sticky across document changes', () => {
  it('defaults every known graph to visible', () => {
    expect([...loadVisibleGraphs([A, B])]).toEqual([A, B]);
  });

  it('keeps a deselected graph hidden when the other graphs change', () => {
    saveVisibleGraphs(new Set([A]), [A, B]);
    // B stays hidden, and C — never seen before — comes in visible.
    expect([...loadVisibleGraphs([A, B, C])].sort()).toEqual([A, C].sort());
  });

  it('keeps a graph hidden across many edits that do not touch it', () => {
    saveVisibleGraphs(new Set([A]), [A, B]);
    for (let i = 0; i < 3; i += 1) {
      const visible = loadVisibleGraphs([A, B]);
      saveVisibleGraphs(visible, [A, B]);
    }
    expect(loadVisibleGraphs([A, B]).has(B)).toBe(false);
  });

  it('prunes a graph that left the document, so re-adding it starts visible', () => {
    saveVisibleGraphs(new Set([A]), [A, B]);
    // B is deleted from the document: saving with the new known set drops it.
    saveVisibleGraphs(new Set([A]), [A]);
    expect(loadVisibleGraphs([A, B]).has(B)).toBe(true);
  });

  it('survives unparsable stored state', () => {
    stored.set('d3fend-graph:hidden-graphs', '{not json');
    expect([...loadVisibleGraphs([A])]).toEqual([A]);
  });
});

describe('graphMatchesQuery', () => {
  const entry = { label: 'G:current', description: 'ssh-authentication' };

  it('matches on the label and on the description, case-insensitively', () => {
    expect(graphMatchesQuery(entry, 'CURR')).toBe(true);
    expect(graphMatchesQuery(entry, 'ssh')).toBe(true);
    expect(graphMatchesQuery(entry, 'nope')).toBe(false);
  });

  it('matches everything on an empty or blank query', () => {
    expect(graphMatchesQuery(entry, '')).toBe(true);
    expect(graphMatchesQuery(entry, '   ')).toBe(true);
    expect(graphMatchesQuery(entry, undefined)).toBe(true);
  });
});
