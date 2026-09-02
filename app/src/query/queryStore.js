/**
 * The browser-local library of saved SPARQL queries, as plain data.
 *
 * A query being refined used to live only in the CodeMirror instance, so F5 —
 * or the reload `npm run dev` fires on HMR — threw it away, while the *view*
 * state around it was persisted. This is the query counterpart of
 * files/fileStore.js (docs/adr/0023-browser-local-file-store.md), and it is
 * deliberately the smaller half: there is no working copy and no autosave. A
 * query enters this store because the user pressed Save, never because they
 * typed. Half a query is not a question, and one reopened from a draft would
 * look like a finished one.
 *
 * Nothing here touches the DOM or storage. query/queryPersist.js stores a store
 * and query/savedQueriesView.js renders one; both go through these functions,
 * so the model is the only writer and stays testable in node.
 *
 * Every mutator returns a *new* store, and every one that can refuse returns
 * either `{store, ...}` or `{error}` — a refusal is never silent.
 */

export const QUERIES_VERSION = 1;

/** Enough for a working set; past this the list stops being scannable. */
export const MAX_QUERIES = 100;

/**
 * localStorage is a shared ~5 MB budget that already holds the documents, the
 * layout, the view preferences and the per-diagram filters. A query is a few
 * hundred bytes, so these ceilings are generous — they exist to refuse a paste
 * of something that is not a query, before it evicts state that has no guard.
 */
export const MAX_QUERY_BYTES = 64 * 1024;
export const MAX_TOTAL_QUERY_BYTES = 512 * 1024;

const MAX_NAME_LENGTH = 120;

/** What a browser charges for a stored string: UTF-16 code units, not bytes. */
export const bytesOf = (text) => String(text ?? '').length;

export function createEmptyStore() {
  return { version: QUERIES_VERSION, queries: [] };
}

function clone(store) {
  return {
    version: QUERIES_VERSION,
    queries: store.queries.map((query) => ({ ...query })),
  };
}

const fail = (message) => ({ error: message });

/**
 * A stored store reconciled with what this build can use. Anything
 * unrecognisable yields an empty library rather than throwing: a corrupt query
 * index must never be able to make the app unloadable.
 */
export function migrate(saved) {
  if (!saved || saved.version !== QUERIES_VERSION || !Array.isArray(saved.queries)) {
    return createEmptyStore();
  }

  const seen = new Set();
  const queries = [];
  for (const record of saved.queries) {
    if (!record || typeof record.id !== 'string' || !record.id) continue;
    if (typeof record.name !== 'string' || !record.name.trim()) continue;
    if (typeof record.sparql !== 'string') continue;
    // A duplicate id would make "open" and "delete" ambiguous; first wins.
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const createdAt = Number(record.createdAt);
    const updatedAt = Number(record.updatedAt);
    queries.push({
      id: record.id,
      name: record.name.trim().slice(0, MAX_NAME_LENGTH),
      sparql: record.sparql,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    });
  }
  return { version: QUERIES_VERSION, queries };
}

export function queryById(store, id) {
  return store.queries.find((query) => query.id === id) ?? null;
}

/** Most recently touched first — the list is a history, not an alphabet. */
export function sortedQueries(store) {
  return [...store.queries].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

export function totalBytes(store) {
  return store.queries.reduce((sum, query) => sum + bytesOf(query.sparql), 0);
}

/** `name` if it is free, else "name (2)", "name (3)"… */
export function uniqueName(store, name, exceptId = null) {
  const base = String(name ?? '').trim().slice(0, MAX_NAME_LENGTH) || 'untitled query';
  const taken = new Set(store.queries.filter((q) => q.id !== exceptId).map((q) => q.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * An id from the clock, disambiguated against what is already there — two
 * queries saved in the same millisecond are possible.
 */
function nextId(store, now) {
  const taken = new Set(store.queries.map((query) => query.id));
  const base = `q${now}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

function checkName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return fail('A query name is required.');
  return { name: trimmed.slice(0, MAX_NAME_LENGTH) };
}

function checkText(sparql) {
  if (!String(sparql ?? '').trim()) return fail('There is nothing to save.');
  return null;
}

/**
 * Whether `sparql` fits, counting `replacingId`'s current size as reclaimed.
 * Refusing is deliberate: evicting a query to make room for another would be
 * the storage layer deciding which of the user's work matters.
 */
function checkCapacity(store, sparql, { replacingId = null, adding = false } = {}) {
  const size = bytesOf(sparql);
  if (size > MAX_QUERY_BYTES) {
    return fail(`That query is larger than the ${Math.round(MAX_QUERY_BYTES / 1024)} KB per-query limit.`);
  }
  if (adding && store.queries.length >= MAX_QUERIES) {
    return fail(`The saved query list is full (${MAX_QUERIES} queries). Delete one first.`);
  }
  const freed = replacingId ? bytesOf(queryById(store, replacingId)?.sparql) : 0;
  if (totalBytes(store) - freed + size > MAX_TOTAL_QUERY_BYTES) {
    return fail(
      `Browser storage for queries is full (${Math.round(MAX_TOTAL_QUERY_BYTES / 1024)} KB). Delete a query first.`,
    );
  }
  return null;
}

export function saveQueryAs(store, name, sparql, now = Date.now()) {
  const empty = checkText(sparql);
  if (empty) return empty;
  const named = checkName(name);
  if (named.error) return named;
  const refused = checkCapacity(store, sparql, { adding: true });
  if (refused) return refused;

  const query = {
    id: nextId(store, now),
    name: uniqueName(store, named.name),
    sparql,
    createdAt: now,
    updatedAt: now,
  };
  const next = clone(store);
  next.queries.push(query);
  return { store: next, query };
}

/** Writes the editor text over the saved query it was opened from. */
export function saveQueryOver(store, id, sparql, now = Date.now()) {
  const query = queryById(store, id);
  if (!query) return fail('That query is no longer in the list.');
  const empty = checkText(sparql);
  if (empty) return empty;
  const refused = checkCapacity(store, sparql, { replacingId: id });
  if (refused) return refused;

  const next = clone(store);
  const target = queryById(next, id);
  target.sparql = sparql;
  target.updatedAt = now;
  return { store: next, query: target };
}

export function renameQuery(store, id, name, now = Date.now()) {
  const query = queryById(store, id);
  if (!query) return fail('That query is no longer in the list.');
  const named = checkName(name);
  if (named.error) return named;
  const next = clone(store);
  const target = queryById(next, id);
  target.name = uniqueName(next, named.name, id);
  target.updatedAt = now;
  return { store: next, query: target };
}

/**
 * Removes a query. The editor keeps whatever it is showing — deleting the query
 * the text came from must not empty the pane — so the text simply stops having
 * a saved query behind it, which the caller sees as a cleared current id.
 */
export function deleteQuery(store, id) {
  if (!queryById(store, id)) return fail('That query is no longer in the list.');
  const next = clone(store);
  next.queries = next.queries.filter((query) => query.id !== id);
  return { store: next };
}
