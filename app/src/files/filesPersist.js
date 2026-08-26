/**
 * localStorage for the document library (docs/adr/0023-browser-local-file-store.md).
 *
 * Two shapes of key, not one blob: the index — the file list plus the working
 * copy — under `d3fend-graph:files`, and one content string per saved file under
 * `d3fend-graph:files/<id>`. Autosave runs on every keystroke burst and only
 * touches the index, so a library of saved documents is not re-serialized to
 * make a character stick.
 *
 * Unlike layout/persist.js, which swallows a failed write on purpose, a failed
 * write here is reported: losing an arrangement costs a drag, losing a document
 * costs the work. `onStorageError` is how main.js gets to say so.
 */

import { createEmptyStore, migrate } from './fileStore.js';

const INDEX_KEY = 'd3fend-graph:files';
const contentKey = (id) => `${INDEX_KEY}/${id}`;

/** Structural writes match layout/persist.js; autosave is lazier on purpose. */
const SAVE_DEBOUNCE_MS = 150;
const WORKING_DEBOUNCE_MS = 500;

let errorHandler = null;
let reportedReason = null;

/** `handler(reason)` with 'quota' or 'unavailable', at most once per reason. */
export function onStorageError(handler) {
  errorHandler = handler;
}

function report(reason) {
  if (reportedReason === reason) return;
  reportedReason = reason;
  errorHandler?.(reason);
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
    reportedReason = null;
    return true;
  } catch (error) {
    const quota =
      error?.name === 'QuotaExceededError' ||
      error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error?.code === 22;
    report(quota ? 'quota' : 'unavailable');
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing the user can act on: the record is already gone from the index.
  }
}

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The stored library, contents hydrated. A record whose content key is missing
 * is dropped rather than resurrected empty — an empty document that claims to be
 * the user's file is worse than one that is visibly gone.
 */
export function loadStore() {
  try {
    const index = readIndex();
    if (!index || !Array.isArray(index.files)) return migrate(index);
    const files = [];
    for (const record of index.files) {
      if (!record || typeof record.id !== 'string') continue;
      const content = localStorage.getItem(contentKey(record.id));
      if (content === null) continue;
      files.push({ ...record, content });
    }
    return migrate({ ...index, files });
  } catch {
    return createEmptyStore();
  }
}

/** The index without the contents: they live under their own keys. */
function indexRecord(store) {
  return {
    version: store.version,
    working: store.working,
    files: store.files.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })),
  };
}

let timer = null;
let pending = null;
let pendingStructural = false;

function flush() {
  timer = null;
  const store = pending;
  const structural = pendingStructural;
  pending = null;
  pendingStructural = false;
  if (!store) return;

  if (structural) {
    // Diffed against what is on disk rather than by enumerating localStorage, so
    // this never has to reason about keys other modules own.
    const previous = readIndex();
    const kept = new Set(store.files.map((file) => file.id));
    for (const record of previous?.files ?? []) {
      if (record?.id && !kept.has(record.id)) remove(contentKey(record.id));
    }
    for (const file of store.files) write(contentKey(file.id), file.content);
  }
  write(INDEX_KEY, JSON.stringify(indexRecord(store)));
}

function schedule(store, structural, delay) {
  pending = store;
  pendingStructural = pendingStructural || structural;
  // A structural write that lands behind a pending autosave takes the shorter
  // delay, so pressing Save never waits on a keystroke timer.
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

/** The file list changed: contents are written too, and orphans are pruned. */
export function saveStore(store) {
  schedule(store, true, SAVE_DEBOUNCE_MS);
}

/** The editor changed: only the index moves, because that is where the working copy lives. */
export function saveWorking(store) {
  schedule(store, false, timer && pendingStructural ? SAVE_DEBOUNCE_MS : WORKING_DEBOUNCE_MS);
}

/** Writes any pending change now — for `beforeunload`, where a timer will not fire. */
export function flushStore() {
  if (!timer) return;
  clearTimeout(timer);
  flush();
}

/** Forgets the whole library. Contents go first, so a failure cannot orphan them. */
export function clearStore(store) {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  pendingStructural = false;
  for (const record of store?.files ?? readIndex()?.files ?? []) {
    if (record?.id) remove(contentKey(record.id));
  }
  remove(INDEX_KEY);
}
