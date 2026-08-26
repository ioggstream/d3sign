/**
 * The Files pane's list (docs/adr/0023-browser-local-file-store.md).
 *
 * Rebuilt wholesale on every change, like viz/diagramList.js: the list is a
 * handful of rows and nothing in it holds state worth preserving across a
 * render. DOM-touching and therefore untested — everything worth asserting is in
 * files/fileStore.js.
 */

import { currentFile, isDirty, sortedFiles } from './fileStore.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" / "12 min ago" / "3 h ago" / a date, once it stops being recent. */
function relativeTime(timestamp, now) {
  const age = now - timestamp;
  if (!Number.isFinite(age) || age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function iconButton(label, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', (event) => {
    // The row itself opens the file; a tool inside it must not also do that.
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * `handlers`: `{onOpen, onSave, onRename, onDelete, onDuplicate, onExport}`,
 * each taking a file id except `onSave`, which writes the working copy over it.
 */
export function renderFilesPane(host, store, handlers, now = Date.now()) {
  host.innerHTML = '';

  const files = sortedFiles(store);
  if (!files.length) {
    const empty = document.createElement('p');
    empty.className = 'filter-list-empty files-empty';
    empty.textContent = 'No saved documents yet — "Save as…" keeps the one you are editing.';
    host.appendChild(empty);
    return;
  }

  const open = currentFile(store);
  const dirty = isDirty(store);

  const list = document.createElement('ul');
  list.className = 'files-list';
  for (const file of files) {
    const item = document.createElement('li');
    const isOpen = open?.id === file.id;
    if (isOpen) item.classList.add('is-current');

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'file-name';
    name.textContent = file.name;
    name.title = isOpen ? 'The document you are editing' : `Open ${file.name}`;
    name.addEventListener('click', () => handlers.onOpen(file.id));
    item.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = relativeTime(file.updatedAt, now);
    item.appendChild(meta);

    const tools = document.createElement('span');
    tools.className = 'file-tools';
    // Save is offered only for the file on screen, and only when it differs:
    // writing the working copy over a file it did not come from is Save as.
    if (isOpen && dirty) {
      tools.appendChild(iconButton('↓', `Save the current text into ${file.name}`, () => handlers.onSave(file.id)));
    }
    tools.appendChild(iconButton('⧉', `Duplicate ${file.name}`, () => handlers.onDuplicate(file.id)));
    tools.appendChild(iconButton('✎', `Rename ${file.name}`, () => handlers.onRename(file.id)));
    tools.appendChild(iconButton('⤓', `Download ${file.name}`, () => handlers.onExport(file.id)));
    tools.appendChild(iconButton('✕', `Delete ${file.name}`, () => handlers.onDelete(file.id)));
    item.appendChild(tools);

    list.appendChild(item);
  }
  host.appendChild(list);
}
