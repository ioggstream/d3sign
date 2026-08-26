/**
 * The browser-local document library, as plain data.
 *
 * The markdown source used to live nowhere: it was seeded from a bundled example
 * and every reload — including the ones `npm run dev` fires on HMR — threw the
 * edits away, while the *view* state around it (layout, filters, preferences)
 * was persisted. This module is the other half: a working copy that is autosaved
 * continuously, plus named files the user saves, reopens and deletes explicitly
 * (docs/adr/0023-browser-local-file-store.md).
 *
 * Nothing here touches the DOM or storage. files/filesPersist.js stores a store
 * and files/filesPane.js renders one; both go through these functions, so the
 * model is the only writer and stays testable in node — the renderer is not
 * (no jsdom in this suite), which is the same split as layout/model.js.
 *
 * Every mutator returns a *new* store, and every one that can refuse returns
 * either `{store, ...}` or `{error}` — a refusal is never silent, because losing
 * a document is not like losing a column width.
 */

export const FILES_VERSION = 1;

/** Enough for a working set; past this the list stops being scannable anyway. */
export const MAX_FILES = 50;

/**
 * localStorage is a shared ~5 MB budget that already holds the layout, the view
 * preferences and the per-diagram filters. These are documents of a few KB, so
 * the ceilings are generous — they exist to refuse a paste of something that is
 * not a document, before it evicts view state that has no such guard.
 */
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

const MAX_NAME_LENGTH = 120;

/** What a browser charges for a stored string: UTF-16 code units, not bytes. */
export const bytesOf = (text) => String(text ?? '').length;

export function createEmptyStore() {
  return {
    version: FILES_VERSION,
    // `pristine` is what makes the badge honest for a document that has no file
    // behind it yet: freshly loaded from an example it is not "unsaved work",
    // and one keystroke later it is.
    working: { baseId: null, content: '', updatedAt: 0, pristine: true },
    files: [],
  };
}

function clone(store) {
  return {
    version: FILES_VERSION,
    working: { ...store.working },
    files: store.files.map((file) => ({ ...file })),
  };
}

const fail = (message) => ({ error: message });

/**
 * A stored store reconciled with what this build can use. Anything
 * unrecognisable yields an empty library rather than throwing: a corrupt file
 * index must never be able to make the app unloadable.
 */
export function migrate(saved) {
  const empty = createEmptyStore();
  if (!saved || saved.version !== FILES_VERSION || !Array.isArray(saved.files)) return empty;

  const seen = new Set();
  const files = [];
  for (const record of saved.files) {
    if (!record || typeof record.id !== 'string' || !record.id) continue;
    if (typeof record.name !== 'string' || !record.name.trim()) continue;
    if (typeof record.content !== 'string') continue;
    // A duplicate id would make "open" and "delete" ambiguous; first wins.
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const createdAt = Number(record.createdAt);
    const updatedAt = Number(record.updatedAt);
    files.push({
      id: record.id,
      name: record.name.trim().slice(0, MAX_NAME_LENGTH),
      content: record.content,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    });
  }

  const working = saved.working ?? {};
  const updatedAt = Number(working.updatedAt);
  const baseId = typeof working.baseId === 'string' && seen.has(working.baseId) ? working.baseId : null;
  return {
    version: FILES_VERSION,
    working: {
      baseId,
      content: typeof working.content === 'string' ? working.content : '',
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      pristine: working.pristine !== false,
    },
    files,
  };
}

export function fileById(store, id) {
  return store.files.find((file) => file.id === id) ?? null;
}

/** The saved file the working copy came from, if it came from one. */
export function currentFile(store) {
  return store.working.baseId ? fileById(store, store.working.baseId) : null;
}

/**
 * Whether the working copy holds work that no file holds. With a file behind it
 * that is a content comparison, so editing back to what was saved clears the
 * badge; without one it is the `pristine` flag, so a freshly loaded example does
 * not claim to be unsaved work.
 */
export function isDirty(store) {
  const file = currentFile(store);
  if (file) return store.working.content !== file.content;
  return !store.working.pristine;
}

/** Most recently touched first — the list is a history, not an alphabet. */
export function sortedFiles(store) {
  return [...store.files].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

export function totalBytes(store) {
  return store.files.reduce((sum, file) => sum + bytesOf(file.content), 0);
}

/**
 * `name` if it is free, else "name (2)", "name (3)"… with the suffix placed
 * before the extension so `doc.md` stays a `.md`.
 */
export function uniqueName(store, name, exceptId = null) {
  const base = String(name ?? '').trim().slice(0, MAX_NAME_LENGTH) || 'untitled.md';
  const taken = new Set(store.files.filter((f) => f.id !== exceptId).map((f) => f.name));
  if (!taken.has(base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * An id from the clock, disambiguated against what is already there — two files
 * created in the same millisecond are possible (Duplicate, then Duplicate).
 */
function nextId(store, now) {
  const taken = new Set(store.files.map((file) => file.id));
  const base = `f${now}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

function checkName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return fail('A file name is required.');
  return { name: trimmed.slice(0, MAX_NAME_LENGTH) };
}

/**
 * Whether `content` fits, counting `replacingId`'s current size as reclaimed.
 * Refusing is deliberate: evicting a document to make room for another would be
 * the storage layer deciding which of the user's work matters.
 */
function checkCapacity(store, content, { replacingId = null, adding = false } = {}) {
  const size = bytesOf(content);
  if (size > MAX_FILE_BYTES) {
    return fail(`That document is larger than the ${Math.round(MAX_FILE_BYTES / 1024)} KB per-file limit.`);
  }
  if (adding && store.files.length >= MAX_FILES) {
    return fail(`The file list is full (${MAX_FILES} files). Delete one first.`);
  }
  const freed = replacingId ? bytesOf(fileById(store, replacingId)?.content) : 0;
  if (totalBytes(store) - freed + size > MAX_TOTAL_BYTES) {
    return fail(`Browser storage for documents is full (${Math.round(MAX_TOTAL_BYTES / 1024)} KB). Delete a file first.`);
  }
  return null;
}

/** The editor changed. A no-op write keeps the store identical, badge included. */
export function setWorkingContent(store, content, now = Date.now()) {
  if (store.working.content === content) return store;
  const next = clone(store);
  next.working.content = content;
  next.working.updatedAt = now;
  next.working.pristine = false;
  return next;
}

/**
 * Replaces the working copy with content that came from outside the library —
 * an example. It is `pristine` and has no file behind it, so it reads as "not
 * yours yet" rather than as unsaved work.
 */
export function openScratch(store, content, now = Date.now()) {
  const next = clone(store);
  next.working = { baseId: null, content, updatedAt: now, pristine: true };
  return next;
}

export function openFile(store, id) {
  const file = fileById(store, id);
  if (!file) return fail('That file is no longer in the list.');
  const next = clone(store);
  next.working = { baseId: id, content: file.content, updatedAt: file.updatedAt, pristine: true };
  return { store: next, content: file.content };
}

export function saveAs(store, name, content, now = Date.now()) {
  const named = checkName(name);
  if (named.error) return named;
  const refused = checkCapacity(store, content, { adding: true });
  if (refused) return refused;

  const file = {
    id: nextId(store, now),
    name: uniqueName(store, named.name),
    content,
    createdAt: now,
    updatedAt: now,
  };
  const next = clone(store);
  next.files.push(file);
  next.working = { baseId: file.id, content, updatedAt: now, pristine: true };
  return { store: next, file };
}

/** Writes the working copy over the file it came from. */
export function saveOver(store, id, content, now = Date.now()) {
  const file = fileById(store, id);
  if (!file) return fail('That file is no longer in the list.');
  const refused = checkCapacity(store, content, { replacingId: id });
  if (refused) return refused;

  const next = clone(store);
  const target = fileById(next, id);
  target.content = content;
  target.updatedAt = now;
  next.working = { baseId: id, content, updatedAt: now, pristine: true };
  return { store: next, file: target };
}

export function renameFile(store, id, name, now = Date.now()) {
  const file = fileById(store, id);
  if (!file) return fail('That file is no longer in the list.');
  const named = checkName(name);
  if (named.error) return named;
  const next = clone(store);
  const target = fileById(next, id);
  target.name = uniqueName(next, named.name, id);
  target.updatedAt = now;
  return { store: next, file: target };
}

/**
 * Removes a file. The editor keeps whatever it is showing — deleting the file a
 * document came from must not empty the pane — so the working copy simply loses
 * its base and becomes unsaved work.
 */
export function deleteFile(store, id) {
  if (!fileById(store, id)) return fail('That file is no longer in the list.');
  const next = clone(store);
  next.files = next.files.filter((file) => file.id !== id);
  if (next.working.baseId === id) {
    next.working.baseId = null;
    next.working.pristine = false;
  }
  return { store: next };
}

/** Copies a file without opening it: duplicating is a backup, not a context switch. */
export function duplicateFile(store, id, now = Date.now()) {
  const file = fileById(store, id);
  if (!file) return fail('That file is no longer in the list.');
  const refused = checkCapacity(store, file.content, { adding: true });
  if (refused) return refused;

  const copy = {
    id: nextId(store, now),
    name: uniqueName(store, file.name),
    content: file.content,
    createdAt: now,
    updatedAt: now,
  };
  const next = clone(store);
  next.files.push(copy);
  return { store: next, file: copy };
}

/** A file from disk: stored and opened, because importing is a "work on this now". */
export function importFile(store, name, content, now = Date.now()) {
  return saveAs(store, name, content, now);
}
