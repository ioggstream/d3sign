import { describe, it, expect } from 'vitest';
import {
  MAX_QUERIES,
  MAX_QUERY_BYTES,
  MAX_TOTAL_QUERY_BYTES,
  createEmptyStore,
  deleteQuery,
  migrate,
  queryById,
  renameQuery,
  saveQueryAs,
  saveQueryOver,
  sortedQueries,
  uniqueName,
} from '../src/query/queryStore.js';

const SPARQL = 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1';

/** A store with `names` saved, each a millisecond apart so the order is stable. */
function storeWith(...names) {
  let store = createEmptyStore();
  names.forEach((name, i) => {
    store = saveQueryAs(store, name, `${SPARQL} # ${name}`, 1000 + i).store;
  });
  return store;
}

describe('saveQueryAs', () => {
  it('keeps the query and leaves the previous store untouched', () => {
    const before = createEmptyStore();
    const { store, query } = saveQueryAs(before, 'artifacts', SPARQL, 1000);
    expect(query).toMatchObject({ name: 'artifacts', sparql: SPARQL, createdAt: 1000, updatedAt: 1000 });
    expect(queryById(store, query.id).sparql).toBe(SPARQL);
    expect(before.queries).toHaveLength(0);
  });

  it('refuses a blank name and empty text', () => {
    expect(saveQueryAs(createEmptyStore(), '   ', SPARQL).error).toMatch(/name is required/);
    expect(saveQueryAs(createEmptyStore(), 'x', '  \n ').error).toMatch(/nothing to save/);
  });

  it('disambiguates a name that is taken', () => {
    const store = storeWith('artifacts', 'artifacts');
    expect(sortedQueries(store).map((q) => q.name).sort()).toEqual(['artifacts', 'artifacts (2)']);
  });

  it('gives two queries saved in the same millisecond different ids', () => {
    let store = createEmptyStore();
    store = saveQueryAs(store, 'a', SPARQL, 7).store;
    store = saveQueryAs(store, 'b', SPARQL, 7).store;
    expect(new Set(store.queries.map((q) => q.id)).size).toBe(2);
  });
});

describe('capacity', () => {
  it('refuses one oversized query rather than storing a truncated one', () => {
    const big = 'x'.repeat(MAX_QUERY_BYTES + 1);
    expect(saveQueryAs(createEmptyStore(), 'big', big).error).toMatch(/per-query limit/);
  });

  it('refuses to exceed the total, and never evicts to make room', () => {
    const chunk = 'x'.repeat(MAX_QUERY_BYTES);
    let store = createEmptyStore();
    for (let i = 0; i < MAX_TOTAL_QUERY_BYTES / MAX_QUERY_BYTES; i += 1) {
      store = saveQueryAs(store, `q${i}`, chunk, 1000 + i).store;
    }
    const kept = store.queries.length;
    expect(saveQueryAs(store, 'one more', chunk).error).toMatch(/storage for queries is full/);
    expect(store.queries).toHaveLength(kept);
  });

  it('counts the overwritten query as reclaimed', () => {
    const chunk = 'x'.repeat(MAX_QUERY_BYTES);
    let store = createEmptyStore();
    for (let i = 0; i < MAX_TOTAL_QUERY_BYTES / MAX_QUERY_BYTES; i += 1) {
      store = saveQueryAs(store, `q${i}`, chunk, 1000 + i).store;
    }
    const id = store.queries[0].id;
    expect(saveQueryOver(store, id, chunk, 9999).error).toBeUndefined();
  });

  it('refuses past the query count', () => {
    let store = createEmptyStore();
    for (let i = 0; i < MAX_QUERIES; i += 1) store = saveQueryAs(store, `q${i}`, SPARQL, 1000 + i).store;
    expect(saveQueryAs(store, 'one more', SPARQL).error).toMatch(/list is full/);
  });
});

describe('saveQueryOver', () => {
  it('replaces the text and moves the timestamp', () => {
    const store = storeWith('artifacts');
    const id = store.queries[0].id;
    const { store: next, query } = saveQueryOver(store, id, 'ASK { ?s ?p ?o }', 5000);
    expect(query).toMatchObject({ id, sparql: 'ASK { ?s ?p ?o }', updatedAt: 5000, createdAt: 1000 });
    expect(next.queries).toHaveLength(1);
  });

  it('refuses an id that is gone', () => {
    expect(saveQueryOver(createEmptyStore(), 'nope', SPARQL).error).toMatch(/no longer in the list/);
  });
});

describe('renameQuery', () => {
  it('renames, and disambiguates against the others but not itself', () => {
    const store = storeWith('a', 'b');
    const [first] = store.queries;
    expect(renameQuery(store, first.id, 'b').query.name).toBe('b (2)');
    expect(renameQuery(store, first.id, 'a').query.name).toBe('a');
  });
});

describe('deleteQuery', () => {
  it('removes only the named query', () => {
    const store = storeWith('a', 'b');
    const { store: next } = deleteQuery(store, store.queries[0].id);
    expect(next.queries.map((q) => q.name)).toEqual(['b']);
  });

  it('refuses an id that is gone', () => {
    expect(deleteQuery(createEmptyStore(), 'nope').error).toMatch(/no longer in the list/);
  });
});

describe('sortedQueries', () => {
  it('puts the most recently touched first', () => {
    const store = storeWith('a', 'b', 'c');
    expect(sortedQueries(store).map((q) => q.name)).toEqual(['c', 'b', 'a']);
  });
});

describe('migrate', () => {
  it('turns anything unusable into an empty store rather than throwing', () => {
    for (const bad of [null, undefined, 42, 'nope', {}, { version: 99, queries: [] }, { version: 1 }]) {
      expect(migrate(bad)).toEqual(createEmptyStore());
    }
  });

  it('drops records that are not queries, and duplicate ids', () => {
    const store = migrate({
      version: 1,
      queries: [
        { id: 'q1', name: 'ok', sparql: SPARQL, createdAt: 1, updatedAt: 2 },
        { id: 'q1', name: 'shadow', sparql: SPARQL },
        { id: '', name: 'no id', sparql: SPARQL },
        { id: 'q2', name: '   ', sparql: SPARQL },
        { id: 'q3', name: 'no text' },
      ],
    });
    expect(store.queries).toHaveLength(1);
    expect(store.queries[0]).toMatchObject({ id: 'q1', name: 'ok' });
  });

  it('replaces a non-numeric timestamp with 0 instead of NaN', () => {
    const store = migrate({
      version: 1,
      queries: [{ id: 'q1', name: 'ok', sparql: SPARQL, createdAt: 'soon', updatedAt: null }],
    });
    expect(store.queries[0]).toMatchObject({ createdAt: 0, updatedAt: 0 });
  });
});

describe('uniqueName', () => {
  it('falls back to a name rather than an empty one', () => {
    expect(uniqueName(createEmptyStore(), '   ')).toBe('untitled query');
  });
});
