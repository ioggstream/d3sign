/**
 * The saved-query list inside the SPARQL pane
 * (docs/adr/0021-sparql-query-pane.md).
 *
 * The same shape as files/filesPane.js, and rebuilt wholesale on every change
 * for the same reason: the list is a handful of rows and nothing in it holds
 * state worth preserving across a render. DOM-touching and therefore untested —
 * everything worth asserting is in query/queryStore.js.
 */

import { sortedQueries } from './queryStore.js';

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
    // The row itself opens the query; a tool inside it must not also do that.
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * `state`: `{currentId, dirty}` — which saved query the editor is showing, and
 * whether its text has since diverged. `dirty` is computed by the caller on
 * render rather than tracked, because this pane has no `onChange` to track it
 * with, and adding one is exactly what ADR 0021 refused.
 *
 * `handlers`: `{onOpen, onOverwrite, onRename, onDelete}`, each taking an id.
 */
export function renderSavedQueries(host, store, state, handlers, now = Date.now()) {
  host.innerHTML = '';

  const queries = sortedQueries(store);
  if (!queries.length) {
    const empty = document.createElement('p');
    empty.className = 'filter-list-empty';
    empty.textContent = 'No saved queries yet — Save keeps the one you are writing.';
    host.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'saved-list';
  for (const query of queries) {
    const item = document.createElement('li');
    const isCurrent = state?.currentId === query.id;
    if (isCurrent) item.classList.add('is-current');

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'file-name';
    name.textContent = query.name;
    name.title = isCurrent ? 'The query in the editor' : `Open ${query.name}`;
    name.addEventListener('click', () => handlers.onOpen(query.id));
    item.appendChild(name);

    // Only the open query can be out of step with what is stored, and saying so
    // is what makes an unpressed Save visible.
    if (isCurrent && state?.dirty) {
      const badge = document.createElement('span');
      badge.className = 'dirty-badge';
      badge.textContent = 'edited';
      badge.title = 'The editor text differs from what is saved';
      item.appendChild(badge);
    }

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = relativeTime(query.updatedAt, now);
    item.appendChild(meta);

    const tools = document.createElement('span');
    tools.className = 'file-tools';
    // Overwrite is offered only for the query on screen, and only when it
    // differs: writing the editor text over a query it did not come from is a
    // new save, not an update.
    if (isCurrent && state?.dirty) {
      tools.appendChild(
        iconButton('↓', `Save the current text into ${query.name}`, () => handlers.onOverwrite(query.id)),
      );
    }
    tools.appendChild(iconButton('✎', `Rename ${query.name}`, () => handlers.onRename(query.id)));
    tools.appendChild(iconButton('✕', `Delete ${query.name}`, () => handlers.onDelete(query.id)));
    item.appendChild(tools);

    list.appendChild(item);
  }
  host.appendChild(list);
}

/**
 * Refills the "Saved queries…" picker. The placeholder is re-selected unless
 * `currentId` is still in the store, so the box never claims the editor holds a
 * saved query when it holds something else.
 */
export function renderSavedSelect(select, store, currentId) {
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = store.queries.length ? 'Saved queries…' : 'No saved queries';
  select.appendChild(placeholder);

  for (const query of sortedQueries(store)) {
    const option = document.createElement('option');
    option.value = query.id;
    option.textContent = query.name;
    select.appendChild(option);
  }
  select.value = currentId && store.queries.some((q) => q.id === currentId) ? currentId : '';
  select.disabled = !store.queries.length;
}
