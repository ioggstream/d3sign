import { describe, it, expect } from 'vitest';

import {
  FILES_VERSION,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  createEmptyStore,
  currentFile,
  deleteFile,
  duplicateFile,
  fileById,
  isDirty,
  migrate,
  openFile,
  openScratch,
  renameFile,
  saveAs,
  saveOver,
  setWorkingContent,
  sortedFiles,
  totalBytes,
  uniqueName,
} from '../src/files/fileStore.js';

// Every mutator takes `now` explicitly so the assertions do not race the clock.
const T0 = 1_000_000;

/** A store holding one saved file, opened, with the working copy matching it. */
function storeWithFile(content = 'body', name = 'doc.md') {
  return saveAs(createEmptyStore(), name, content, T0).store;
}

describe('migrate', () => {
  it('returns an empty store for nothing, the wrong version or the wrong shape', () => {
    const empty = createEmptyStore();
    expect(migrate(null)).toEqual(empty);
    expect(migrate({ version: FILES_VERSION + 1, files: [] })).toEqual(empty);
    expect(migrate({ version: FILES_VERSION, files: 'nope' })).toEqual(empty);
    expect(migrate([1, 2, 3])).toEqual(empty);
  });

  it('drops records that could not be opened or named', () => {
    const store = migrate({
      version: FILES_VERSION,
      working: { baseId: null, content: '', updatedAt: 0, pristine: true },
      files: [
        { id: 'a', name: 'a.md', content: 'A', createdAt: 1, updatedAt: 2 },
        { id: 'b', name: '   ', content: 'B' },
        { id: '', name: 'c.md', content: 'C' },
        { id: 'd', name: 'd.md' },
        null,
      ],
    });
    expect(store.files.map((f) => f.id)).toEqual(['a']);
  });

  it('keeps the first of two records sharing an id', () => {
    const store = migrate({
      version: FILES_VERSION,
      files: [
        { id: 'a', name: 'first.md', content: 'one' },
        { id: 'a', name: 'second.md', content: 'two' },
      ],
    });
    expect(store.files).toHaveLength(1);
    expect(store.files[0].name).toBe('first.md');
  });

  it('coerces unusable timestamps to zero', () => {
    const store = migrate({
      version: FILES_VERSION,
      files: [{ id: 'a', name: 'a.md', content: 'A', createdAt: 'yesterday', updatedAt: NaN }],
    });
    expect(store.files[0]).toMatchObject({ createdAt: 0, updatedAt: 0 });
  });

  it('clears a working baseId pointing at a file that did not survive', () => {
    const store = migrate({
      version: FILES_VERSION,
      working: { baseId: 'gone', content: 'text', updatedAt: 5, pristine: false },
      files: [],
    });
    expect(store.working.baseId).toBeNull();
    expect(store.working.content).toBe('text');
  });
});

describe('uniqueName', () => {
  it('leaves a free name alone', () => {
    expect(uniqueName(createEmptyStore(), 'doc.md')).toBe('doc.md');
  });

  it('numbers a collision before the extension', () => {
    let store = storeWithFile('a', 'doc.md');
    expect(uniqueName(store, 'doc.md')).toBe('doc (2).md');
    store = saveAs(store, 'doc.md', 'b', T0).store;
    expect(store.files[1].name).toBe('doc (2).md');
    expect(uniqueName(store, 'doc.md')).toBe('doc (3).md');
  });

  it('ignores the file being renamed, so keeping a name is not a collision', () => {
    const store = storeWithFile('a', 'doc.md');
    expect(uniqueName(store, 'doc.md', store.files[0].id)).toBe('doc.md');
  });

  it('falls back to a name when given none', () => {
    expect(uniqueName(createEmptyStore(), '   ')).toBe('untitled.md');
  });
});

describe('isDirty', () => {
  it('is false for a freshly loaded example and true after one edit', () => {
    let store = openScratch(createEmptyStore(), 'example', T0);
    expect(isDirty(store)).toBe(false);
    store = setWorkingContent(store, 'example edited', T0 + 1);
    expect(isDirty(store)).toBe(true);
  });

  it('follows the content once a file is behind the working copy', () => {
    let store = storeWithFile('body');
    expect(isDirty(store)).toBe(false);
    store = setWorkingContent(store, 'body!', T0 + 1);
    expect(isDirty(store)).toBe(true);
    // Edited back to what was saved: nothing is unsaved any more.
    store = setWorkingContent(store, 'body', T0 + 2);
    expect(isDirty(store)).toBe(false);
  });

  it('is true again once the file behind the working copy is deleted', () => {
    const store = storeWithFile('body');
    const after = deleteFile(store, store.files[0].id).store;
    expect(currentFile(after)).toBeNull();
    expect(isDirty(after)).toBe(true);
    expect(after.working.content).toBe('body');
  });
});

describe('setWorkingContent', () => {
  it('returns the same store for a write that changes nothing', () => {
    const store = openScratch(createEmptyStore(), 'same', T0);
    expect(setWorkingContent(store, 'same', T0 + 1)).toBe(store);
  });

  it('never mutates the store it was given', () => {
    const store = openScratch(createEmptyStore(), 'before', T0);
    setWorkingContent(store, 'after', T0 + 1);
    expect(store.working.content).toBe('before');
  });
});

describe('saveAs / saveOver', () => {
  it('stores the text and opens what it stored', () => {
    const { store, file } = saveAs(createEmptyStore(), 'doc.md', 'body', T0);
    expect(file).toMatchObject({ name: 'doc.md', content: 'body', createdAt: T0, updatedAt: T0 });
    expect(currentFile(store)).toMatchObject({ id: file.id });
    expect(isDirty(store)).toBe(false);
  });

  it('refuses an empty name', () => {
    expect(saveAs(createEmptyStore(), '  ', 'body', T0).error).toBeTruthy();
  });

  it('gives files created in the same millisecond distinct ids', () => {
    let store = saveAs(createEmptyStore(), 'a.md', 'a', T0).store;
    store = saveAs(store, 'b.md', 'b', T0).store;
    expect(store.files[0].id).not.toBe(store.files[1].id);
  });

  it('writes the working copy over the file it came from', () => {
    let store = storeWithFile('body');
    const id = store.files[0].id;
    store = setWorkingContent(store, 'edited', T0 + 1);
    const saved = saveOver(store, id, store.working.content, T0 + 2);
    expect(fileById(saved.store, id)).toMatchObject({ content: 'edited', updatedAt: T0 + 2 });
    expect(isDirty(saved.store)).toBe(false);
  });

  it('refuses to write over a file that is gone', () => {
    expect(saveOver(createEmptyStore(), 'missing', 'body', T0).error).toBeTruthy();
  });
});

describe('openFile', () => {
  it('returns the content and clears the dirty state', () => {
    let store = storeWithFile('saved');
    const id = store.files[0].id;
    store = setWorkingContent(store, 'scratch', T0 + 1);
    const opened = openFile(store, id);
    expect(opened.content).toBe('saved');
    expect(opened.store.working.content).toBe('saved');
    expect(isDirty(opened.store)).toBe(false);
  });

  it('refuses an id that is not in the list', () => {
    expect(openFile(createEmptyStore(), 'missing').error).toBeTruthy();
  });
});

describe('renameFile', () => {
  it('renames, and numbers the name if it is taken', () => {
    let store = storeWithFile('a', 'a.md');
    store = saveAs(store, 'b.md', 'b', T0).store;
    const renamed = renameFile(store, store.files[1].id, 'a.md', T0 + 1);
    expect(renamed.file.name).toBe('a (2).md');
  });

  it('refuses an empty name and a missing file', () => {
    const store = storeWithFile('a');
    expect(renameFile(store, store.files[0].id, '', T0).error).toBeTruthy();
    expect(renameFile(store, 'missing', 'x.md', T0).error).toBeTruthy();
  });
});

describe('duplicateFile', () => {
  it('copies the content under a free name without switching to it', () => {
    const store = storeWithFile('body', 'doc.md');
    const copied = duplicateFile(store, store.files[0].id, T0 + 1);
    expect(copied.file).toMatchObject({ name: 'doc (2).md', content: 'body' });
    expect(currentFile(copied.store).id).toBe(store.files[0].id);
  });
});

describe('limits', () => {
  it('refuses a document larger than the per-file limit', () => {
    const huge = 'x'.repeat(MAX_FILE_BYTES + 1);
    expect(saveAs(createEmptyStore(), 'big.md', huge, T0).error).toBeTruthy();
  });

  it('refuses a new file once the list is full', () => {
    let store = createEmptyStore();
    for (let n = 0; n < MAX_FILES; n += 1) store = saveAs(store, `doc-${n}.md`, 'x', T0 + n).store;
    expect(store.files).toHaveLength(MAX_FILES);
    expect(saveAs(store, 'one-more.md', 'x', T0).error).toBeTruthy();
  });

  it('refuses a write that would take the library past the total limit', () => {
    const big = 'x'.repeat(MAX_FILE_BYTES);
    let store = createEmptyStore();
    while (totalBytes(store) + MAX_FILE_BYTES <= MAX_TOTAL_BYTES) {
      store = saveAs(store, `doc-${store.files.length}.md`, big, T0).store;
    }
    expect(saveAs(store, 'overflow.md', big, T0).error).toBeTruthy();
    // Rewriting a file in place reclaims its own size, so it still fits.
    expect(saveOver(store, store.files[0].id, big, T0 + 1).error).toBeUndefined();
  });
});

describe('sortedFiles', () => {
  it('lists the most recently touched first', () => {
    let store = saveAs(createEmptyStore(), 'old.md', 'a', T0).store;
    store = saveAs(store, 'new.md', 'b', T0 + 10).store;
    expect(sortedFiles(store).map((f) => f.name)).toEqual(['new.md', 'old.md']);
  });
});
