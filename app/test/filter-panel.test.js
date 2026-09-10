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
let NODE_KINDS;

beforeAll(async () => {
  ({ loadFilterState, saveFilterState } = await import('../src/viz/filterPanel.js'));
  ({ LINK_KINDS } = await import('../src/rdf/linkKind.js'));
  ({ NODE_KINDS } = await import('../src/rdf/nodeKind.js'));
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
    // `kinds` is what makes "hidden" legible: without it a kind missing from
    // `visibleKinds` is indistinguishable from one that did not exist yet, and
    // the migration above puts it back. Every payload `saveFilterState` writes
    // carries the field, so this is the shape the check has to be made against.
    stored.set(
      KEY,
      JSON.stringify({
        visibleKinds: LINK_KINDS.filter((k) => k !== 'data-flow'),
        kinds: [...LINK_KINDS],
      }),
    );

    const { visibleKinds } = loadFilterState(DIAGRAM, []);
    expect(visibleKinds.has('data-flow')).toBe(false);
    expect(visibleKinds.has('connectivity')).toBe(true);
  });

  it('cannot keep one hidden by a payload predating the vocabulary field', () => {
    // The acknowledged cost of the fallback: a pre-`kinds` payload that hid
    // data-flow reads exactly like one written before the kind existed, so the
    // migration restores it. One re-hide, once, against edges lost forever.
    stored.set(KEY, JSON.stringify({ visibleKinds: LINK_KINDS.filter((k) => k !== 'data-flow') }));

    expect(loadFilterState(DIAGRAM, []).visibleKinds.has('data-flow')).toBe(true);
  });

  it('round-trips through saveFilterState', () => {
    const state = loadFilterState(DIAGRAM, ['d3f:connected-to']);
    state.visibleKinds.delete('connectivity');
    saveFilterState(DIAGRAM, state);

    expect(loadFilterState(DIAGRAM, []).visibleKinds.has('connectivity')).toBe(false);
  });
});

describe('loadFilterState — visibleNodeKinds', () => {
  it('shows every node kind when nothing is saved', () => {
    const { visibleNodeKinds } = loadFilterState(DIAGRAM, []);
    expect([...visibleNodeKinds].sort()).toEqual([...NODE_KINDS].sort());
  });

  it('shows a node kind added after the payload was written', () => {
    // A pre-Events payload: the bucket is absent because it did not exist yet.
    stored.set(
      KEY,
      JSON.stringify({ visibleNodeKinds: ['artifacts', 'actors', 'tactical', 'legal', 'other'] }),
    );

    const { visibleNodeKinds } = loadFilterState(DIAGRAM, []);
    expect(visibleNodeKinds.has('events')).toBe(true);
  });

  it('keeps a node kind the user explicitly hid', () => {
    stored.set(
      KEY,
      JSON.stringify({
        visibleNodeKinds: NODE_KINDS.filter((k) => k !== 'events'),
        nodeKinds: [...NODE_KINDS],
      }),
    );

    const { visibleNodeKinds } = loadFilterState(DIAGRAM, []);
    expect(visibleNodeKinds.has('events')).toBe(false);
  });
});
