/**
 * The DOM half of the results pane. Everything it draws was decided by
 * resultModel.js — this file only builds elements, which is why it has no tests
 * and resultModel.js has many.
 */

import { CONSTRUCT_GRAPH_CAP, resultTsv } from './resultModel.js';
import { wireCopyButton } from '../clipboard.js';

function clear(host) {
  host.replaceChildren();
}

export function renderQueryStatus(host, text, { kind = 'info' } = {}) {
  host.textContent = text;
  host.classList.toggle('is-error', kind === 'error');
  host.classList.toggle('is-busy', kind === 'busy');
}

export function renderQueryPlaceholder(host, message) {
  clear(host);
  const empty = document.createElement('p');
  empty.className = 'query-empty';
  empty.textContent = message;
  host.append(empty);
}

/**
 * Draws a table.
 *
 * `onReveal` is offered per cell rather than per row: a row can name several
 * nodes, and which one the user wants is the one they clicked.
 */
export function renderQueryResults(host, table, { onReveal, onAddGraph } = {}) {
  clear(host);

  if (!table.rows.length) {
    renderQueryPlaceholder(host, 'No results.');
    return;
  }

  host.append(copyTableButton(table));

  if (table.truncated || table.capped) {
    const warning = document.createElement('p');
    warning.className = 'query-warning';
    warning.textContent = table.truncated
      ? `The engine stopped at ${table.shown} rows — this result is incomplete. Narrow the query.`
      : `Showing the first ${table.shown} of ${table.rowCount} rows.`;
    host.append(warning);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'query-table-wrap';
  const el = document.createElement('table');
  el.className = 'query-table';

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of table.columns) {
    const th = document.createElement('th');
    th.textContent = table.kind === 'select' ? `?${column}` : column;
    headRow.append(th);
  }
  head.append(headRow);
  el.append(head);

  const body = document.createElement('tbody');
  for (const row of table.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.className = `query-cell query-cell--${cell.kind}`;
      if (cell.title) td.title = cell.title;

      const text = document.createElement('span');
      text.className = 'query-cell-text';
      text.textContent = cell.text;
      td.append(text);

      // Only for a node the graph is actually drawing: offering to reveal
      // anything else would promise a jump that goes nowhere.
      if (cell.inGraph && onReveal) {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'query-reveal';
        reveal.textContent = '◎';
        reveal.title = `Show ${cell.text} in the graph`;
        reveal.addEventListener('click', () => onReveal(cell.iri));
        td.append(reveal);
      }
      tr.append(td);
    }
    body.append(tr);
  }
  el.append(body);
  wrapper.append(el);
  host.append(wrapper);

  if (table.kind === 'construct') renderAddGraph(host, table, onAddGraph);
}

/**
 * Above the table, not below it: a long result would push a footer button off
 * the bottom of the pane, and the rows it copies are the rows at the top.
 */
function copyTableButton(table) {
  const actions = document.createElement('div');
  actions.className = 'query-results-actions';

  const copy = document.createElement('button');
  copy.type = 'button';
  // `.copy-button`, not `.btn`, because the copied / failed states are styled on it.
  copy.className = 'copy-button';
  copy.textContent = 'Copy table';
  copy.title = 'Copy the table as tab-separated text, to paste into a spreadsheet';
  wireCopyButton(copy, () => resultTsv(table));

  actions.append(copy);
  return actions;
}

/**
 * The enrichment affordance: a CONSTRUCT result can become a named graph of its
 * own, which the graph view then draws with no further plumbing
 * (docs/adr/0014-graph-view-from-rdf-only.md).
 */
function renderAddGraph(host, table, onAddGraph) {
  const footer = document.createElement('div');
  footer.className = 'query-construct-actions';

  if (!onAddGraph) return;

  if (!table.addableQuads) {
    const note = document.createElement('p');
    note.className = 'query-warning';
    note.textContent = table.truncated
      ? 'Cannot add an incomplete result as a graph.'
      : `Too many triples to draw (${table.rowCount} > ${CONSTRUCT_GRAPH_CAP}). Narrow the query.`;
    footer.append(note);
    host.append(footer);
    return;
  }

  const label = document.createElement('label');
  label.className = 'query-construct-name';
  label.textContent = 'Add as graph:';
  const name = document.createElement('input');
  name.type = 'text';
  name.value = 'enrichment';
  name.className = 'query-construct-input';
  label.append(name);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'copy-button';
  add.textContent = `Add ${table.addableQuads} triples`;
  add.addEventListener('click', () => onAddGraph(name.value.trim() || 'enrichment'));

  footer.append(label, add);
  host.append(footer);
}
