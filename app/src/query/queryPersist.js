/**
 * localStorage for the saved-query library (docs/adr/0021-sparql-query-pane.md).
 *
 * One key, not the index-plus-contents split files/filesPersist.js uses: that
 * split exists because autosave rewrites the index on every keystroke burst and
 * must not re-serialize every document to make a character stick. Nothing
 * autosaves here, so a write only ever follows a deliberate Save, Rename or
 * Delete — and a whole library of queries is smaller than one document.
 *
 * A failed write is reported rather than swallowed, for the same reason as the
 * document library: losing an arrangement costs a drag, losing saved work costs
 * the work.
 */

import { createEmptyStore, migrate } from './queryStore.js';

export const QUERIES_KEY = 'd3fend-graph:queries';

/** Matches the structural delay in files/filesPersist.js. */
const SAVE_DEBOUNCE_MS = 150;

let errorHandler = null;
let reportedReason = null;

/** `handler(reason)` with 'quota' or 'unavailable', at most once per reason. */
export function onQueryStorageError(handler) {
  errorHandler = handler;
}

function report(reason) {
  if (reportedReason === reason) return;
  reportedReason = reason;
  errorHandler?.(reason);
}

function write(value) {
  try {
    localStorage.setItem(QUERIES_KEY, value);
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

export function loadQueries() {
  try {
    const raw = localStorage.getItem(QUERIES_KEY);
    return migrate(raw ? JSON.parse(raw) : null);
  } catch {
    return createEmptyStore();
  }
}

let timer = null;
let pending = null;

function flush() {
  timer = null;
  const store = pending;
  pending = null;
  if (store) write(JSON.stringify(store));
}

export function saveQueries(store) {
  pending = store;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
}

/** Writes any pending change now — for `beforeunload`, where a timer will not fire. */
export function flushQueries() {
  if (!timer) return;
  clearTimeout(timer);
  flush();
}

/**
 * Forgets the whole library, pending write included. Dropping `pending` first
 * is what stops a debounced Save from resurrecting what was just destroyed.
 */
export function clearQueries() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  try {
    localStorage.removeItem(QUERIES_KEY);
  } catch {
    // Nothing the user can act on, and the in-memory store is already empty.
  }
}
