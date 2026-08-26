import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// The module reads localStorage at call time; the test runner is plain node, so
// stub it before importing (a static import would hoist above the assignment).
const stored = new Map();
let failWrites = null;
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => {
    if (failWrites) throw failWrites;
    stored.set(k, String(v));
  },
  removeItem: (k) => stored.delete(k),
};

const INDEX_KEY = 'd3fend-graph:files';
const contentKey = (id) => `${INDEX_KEY}/${id}`;

let loadStore;
let saveStore;
let saveWorking;
let flushStore;
let clearStore;
let onStorageError;
let createEmptyStore;
let saveAs;
let setWorkingContent;
let deleteFile;

beforeAll(async () => {
  ({ loadStore, saveStore, saveWorking, flushStore, clearStore, onStorageError } = await import(
    '../src/files/filesPersist.js'
  ));
  ({ createEmptyStore, saveAs, setWorkingContent, deleteFile } = await import('../src/files/fileStore.js'));
});

beforeEach(() => {
  stored.clear();
  failWrites = null;
  onStorageError(null);
  vi.useRealTimers();
});

const T0 = 1_000_000;

function libraryOfTwo() {
  let store = saveAs(createEmptyStore(), 'a.md', 'AAA', T0).store;
  store = saveAs(store, 'b.md', 'BBB', T0 + 1).store;
  return store;
}

describe('loadStore', () => {
  it('returns an empty store when nothing is stored', () => {
    expect(loadStore()).toEqual(createEmptyStore());
  });

  it('returns an empty store for a corrupt index rather than throwing', () => {
    stored.set(INDEX_KEY, '{not json');
    expect(loadStore()).toEqual(createEmptyStore());
  });

  it('round-trips a library across the split keys', () => {
    vi.useFakeTimers();
    const store = libraryOfTwo();
    saveStore(store);
    vi.advanceTimersByTime(200);
    // Contents live under their own keys, not inside the index.
    expect(stored.get(contentKey(store.files[0].id))).toBe('AAA');
    expect(JSON.parse(stored.get(INDEX_KEY)).files[0].content).toBeUndefined();
    expect(loadStore()).toEqual(store);
  });

  it('drops a record whose content key is missing instead of resurrecting it empty', () => {
    vi.useFakeTimers();
    const store = libraryOfTwo();
    saveStore(store);
    vi.advanceTimersByTime(200);
    stored.delete(contentKey(store.files[0].id));
    const loaded = loadStore();
    expect(loaded.files.map((f) => f.name)).toEqual(['b.md']);
  });
});

describe('saveStore', () => {
  it('debounces and collapses a burst into the last write', () => {
    vi.useFakeTimers();
    const first = libraryOfTwo();
    const last = saveAs(first, 'c.md', 'CCC', T0 + 2).store;
    saveStore(first);
    expect(stored.has(INDEX_KEY)).toBe(false);
    saveStore(last);
    vi.advanceTimersByTime(200);
    expect(loadStore()).toEqual(last);
  });

  it('prunes the content key of a file that was deleted', () => {
    vi.useFakeTimers();
    const store = libraryOfTwo();
    const goneId = store.files[0].id;
    saveStore(store);
    vi.advanceTimersByTime(200);

    saveStore(deleteFile(store, goneId).store);
    vi.advanceTimersByTime(200);
    expect(stored.has(contentKey(goneId))).toBe(false);
    expect(stored.has(contentKey(store.files[1].id))).toBe(true);
  });
});

describe('saveWorking', () => {
  it('writes only the index, leaving the stored contents untouched', () => {
    vi.useFakeTimers();
    const store = libraryOfTwo();
    saveStore(store);
    vi.advanceTimersByTime(200);
    stored.delete(contentKey(store.files[0].id));

    saveWorking(setWorkingContent(store, 'typing', T0 + 5));
    vi.advanceTimersByTime(600);
    // The content key it never wrote is still missing — proof it wrote the index alone.
    expect(stored.has(contentKey(store.files[0].id))).toBe(false);
    expect(JSON.parse(stored.get(INDEX_KEY)).working.content).toBe('typing');
  });

  it('is lazier than a structural save', () => {
    vi.useFakeTimers();
    saveWorking(setWorkingContent(createEmptyStore(), 'typing', T0));
    vi.advanceTimersByTime(200);
    expect(stored.has(INDEX_KEY)).toBe(false);
    vi.advanceTimersByTime(400);
    expect(loadStore().working.content).toBe('typing');
  });
});

describe('flushStore', () => {
  it('writes a pending change immediately, as unload needs', () => {
    vi.useFakeTimers();
    saveWorking(setWorkingContent(createEmptyStore(), 'typing', T0));
    flushStore();
    expect(loadStore().working.content).toBe('typing');
  });
});

describe('clearStore', () => {
  it('removes the index, the contents and any pending write', () => {
    vi.useFakeTimers();
    const store = libraryOfTwo();
    saveStore(store);
    vi.advanceTimersByTime(200);

    saveWorking(setWorkingContent(store, 'typing', T0 + 5));
    clearStore(store);
    vi.advanceTimersByTime(600);
    expect(stored.size).toBe(0);
    expect(loadStore()).toEqual(createEmptyStore());
  });
});

describe('storage failure', () => {
  it('reports a full quota once and leaves the last good state readable', () => {
    vi.useFakeTimers();
    const reasons = [];
    onStorageError((reason) => reasons.push(reason));

    const store = libraryOfTwo();
    saveStore(store);
    vi.advanceTimersByTime(200);

    const quota = new Error('full');
    quota.name = 'QuotaExceededError';
    failWrites = quota;
    saveWorking(setWorkingContent(store, 'typing', T0 + 5));
    vi.advanceTimersByTime(600);
    saveWorking(setWorkingContent(store, 'typing more', T0 + 6));
    vi.advanceTimersByTime(600);

    expect(reasons).toEqual(['quota']);
    expect(loadStore().files.map((f) => f.name)).toEqual(['a.md', 'b.md']);
  });

  it('reports an unavailable storage separately from a full one', () => {
    vi.useFakeTimers();
    const reasons = [];
    onStorageError((reason) => reasons.push(reason));
    failWrites = new Error('denied');
    saveStore(libraryOfTwo());
    vi.advanceTimersByTime(200);
    expect(reasons).toEqual(['unavailable']);
  });
});
