import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// The module reads localStorage at call time; the test runner is plain node, so
// stub it before importing (a static import would hoist above the assignment).
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};

const STORAGE_KEY = 'd3fend-graph:layout';

const VIEWS = [
  { id: 'editor', defaultColumn: 0 },
  { id: 'trig', defaultColumn: 2 },
  { id: 'graph', defaultColumn: 2, defaultActive: true },
];

let loadLayout;
let saveLayout;
let clearLayout;
let createDefaultLayout;
let moveView;

beforeAll(async () => {
  ({ loadLayout, saveLayout, clearLayout } = await import('../src/layout/persist.js'));
  ({ createDefaultLayout, moveView } = await import('../src/layout/model.js'));
});

beforeEach(() => {
  stored.clear();
  vi.useRealTimers();
});

describe('loadLayout', () => {
  it('returns the default when nothing is stored', () => {
    expect(loadLayout(VIEWS)).toEqual(createDefaultLayout(VIEWS));
  });

  it('returns the default for unparseable JSON rather than throwing', () => {
    stored.set(STORAGE_KEY, '{not json');
    expect(loadLayout(VIEWS)).toEqual(createDefaultLayout(VIEWS));
  });

  it('returns the default for JSON of the wrong shape', () => {
    stored.set(STORAGE_KEY, '[1, 2, 3]');
    expect(loadLayout(VIEWS)).toEqual(createDefaultLayout(VIEWS));
  });

  it('reconciles what it read against the registry', () => {
    const layout = createDefaultLayout(VIEWS);
    layout.columns[0].views.push('removed-in-a-later-build');
    stored.set(STORAGE_KEY, JSON.stringify(layout));
    expect(loadLayout(VIEWS).columns[0].views).toEqual(['editor']);
  });
});

describe('saveLayout', () => {
  it('debounces, then writes a layout loadLayout can read back', async () => {
    vi.useFakeTimers();
    const layout = moveView(createDefaultLayout(VIEWS), 'trig', 1);
    saveLayout(layout);
    expect(stored.has(STORAGE_KEY)).toBe(false);
    vi.advanceTimersByTime(200);
    expect(loadLayout(VIEWS)).toEqual(layout);
  });

  it('collapses a burst of writes into the last one', () => {
    vi.useFakeTimers();
    const first = createDefaultLayout(VIEWS);
    const last = moveView(first, 'graph', 0);
    saveLayout(first);
    saveLayout(last);
    vi.advanceTimersByTime(200);
    expect(loadLayout(VIEWS)).toEqual(last);
  });
});

describe('clearLayout', () => {
  it('removes the key and cancels a pending write', () => {
    vi.useFakeTimers();
    saveLayout(moveView(createDefaultLayout(VIEWS), 'graph', 0));
    clearLayout();
    vi.advanceTimersByTime(200);
    expect(stored.has(STORAGE_KEY)).toBe(false);
    expect(loadLayout(VIEWS)).toEqual(createDefaultLayout(VIEWS));
  });
});
