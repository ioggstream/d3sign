/**
 * The bridge between the browser-local library and the real filesystem
 * (docs/adr/0023-browser-local-file-store.md).
 *
 * A Blob download and an `<input type="file">`, not the File System Access API:
 * `showSaveFilePicker` is Chromium-only, and a store that is already
 * browser-local gains little from a handle it cannot keep on Firefox.
 *
 * DOM-touching and therefore untested — the suite runs in node with no jsdom.
 * There is no logic here to test; the model is in files/fileStore.js.
 */

export function downloadText(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not immediately: Safari has not started the download when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Wraps an `<input type="file">` change into a promise of `{name, text}`, or
 * null if the picker was dismissed. The input is cleared so that re-picking the
 * same file fires `change` again.
 */
export function pickTextFile(input) {
  return new Promise((resolve) => {
    const onChange = async () => {
      input.removeEventListener('change', onChange);
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve({ name: file.name, text: await file.text() });
      } catch {
        resolve(null);
      }
    };
    input.addEventListener('change', onChange);
    input.click();
  });
}
