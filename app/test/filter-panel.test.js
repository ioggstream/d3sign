import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// The module reads localStorage at call time; the test runner is plain node, so
// stub it before importing (a static import would hoist above the assignment).
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};

let loadFilterState;
let saveFilterState;
let LINK_KINDS;

beforeAll(async () => {
  ({ loadFilterState, saveFilterState } = await import('../src/viz/filterPanel.js'));
  ({ LINK_KINDS } = await import('../src/rdf/linkKind.js'));
});

beforeEach(() => stored.clear());

const DIAGRAM = 'net';
const KEY = `d3fend-graph:filter-state:${DIAGRAM}`;

describe('loadFilterState — visibleKinds', () => {
  it('shows every kind when nothing is saved', () => {
    const { visibleKinds } = loadFilterState(DIAGRAM, []);
    expect([...visibleKinds].sort()).toEqual([...LINK_KINDS].sort());
  });

  it('shows a kind added after the payload was written', () => {
    // A pre-connectivity payload: the kind is absent because it did not exist yet,
    // not because the user hid it.
    stored.set(
      KEY,
      JSON.stringify({ visibleKinds: ['data-flow', 'control-flow', 'tactical-verb', 'other'] }),
    );

    const { visibleKinds } = loadFilterState(DIAGRAM, []);
    expect(visibleKinds.has('connectivity')).toBe(true);
  });

  it('keeps a kind the user explicitly hid', () => {
    stored.set(KEY, JSON.stringify({ visibleKinds: LINK_KINDS.filter((k) => k !== 'data-flow') }));

    const { visibleKinds } = loadFilterState(DIAGRAM, []);
    expect(visibleKinds.has('data-flow')).toBe(false);
    expect(visibleKinds.has('connectivity')).toBe(true);
  });

  it('round-trips through saveFilterState', () => {
    const state = loadFilterState(DIAGRAM, ['d3f:connected-to']);
    state.visibleKinds.delete('connectivity');
    saveFilterState(DIAGRAM, state);

    expect(loadFilterState(DIAGRAM, []).visibleKinds.has('connectivity')).toBe(false);
  });
});
