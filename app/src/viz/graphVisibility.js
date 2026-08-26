import { renderBulkActions } from './filterChip.js';

// Persists the *hidden* graphs, not the visible ones, so every graph is selected by
// default — including one the user has never seen (a new diagram `id:`, or a freshly
// loaded example). An allow-list would leave those deselected and show an empty view.
const STORAGE_KEY = 'd3fend-graph:hidden-graphs';

export function loadVisibleGraphs(graphNames) {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    saved = null;
  }
  const hidden = new Set(Array.isArray(saved) ? saved : []);
  return new Set([...graphNames].filter((name) => !hidden.has(name)));
}

/**
 * Stores which of `knownGraphNames` are currently deselected. Names outside that
 * set are dropped, so stale entries don't accumulate.
 */
export function saveVisibleGraphs(visibleGraphs, knownGraphNames) {
  const hidden = [...knownGraphNames].filter((name) => !visibleGraphs.has(name));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
}

/**
 * Case-insensitive substring match over what the panel shows for a graph (its
 * label and the tooltip description), so the keyboard filter and the Enter-toggle
 * agree on which graphs are "shown".
 */
export function graphMatchesQuery(entry, query) {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return true;
  return `${entry.label} ${entry.description ?? ''}`.toLowerCase().includes(needle);
}

/**
 * Renders a checkbox per known named graph (one per diagram, plus enrichment),
 * letting the user toggle each graph's contribution to the merged view independently.
 * The panel is titled by its filter chip, so it renders no heading of its own.
 * `bulkHost` receives the all/none shortcut, which reports through `onSetAll`
 * so a bulk change costs one re-render rather than one per graph.
 * `query` narrows the list to the matching graphs, which is what the Alt+T
 * keyboard filter renders through.
 */
export function renderGraphPanel(host, contributions, visibleGraphs, onToggle, { bulkHost, onSetAll, query } = {}) {
  host.innerHTML = '';

  if (bulkHost && onSetAll) {
    renderBulkActions(bulkHost, {
      onAll: () => onSetAll(true),
      onNone: () => onSetAll(false),
    });
  }

  const list = document.createElement('ul');
  list.className = 'filter-list graph-visibility-list';

  const matching = contributions.filter((c) => graphMatchesQuery(c, query));
  // Anything that is not enrichment is listed with the diagrams, so a graph
  // typed straight into the TriG pane (`kind: 'manual'`) still gets a checkbox.
  const enrichmentEntries = matching.filter((c) => c.kind === 'enrichment');
  const diagramEntries = matching.filter((c) => c.kind !== 'enrichment');

  const addItem = (entry) => {
    const item = document.createElement('li');
    if (entry.description) item.title = entry.description;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = visibleGraphs.has(entry.name);
    checkbox.addEventListener('change', () => onToggle(entry.name, checkbox.checked));

    const label = document.createElement('label');
    label.textContent = ` ${entry.label} `;
    label.prepend(checkbox);
    item.appendChild(label);
    list.appendChild(item);
  };

  if (!matching.length) {
    const empty = document.createElement('li');
    empty.className = 'filter-list-empty';
    empty.textContent = 'no matching graph';
    list.appendChild(empty);
  }

  for (const entry of diagramEntries) addItem(entry);

  if (enrichmentEntries.length) {
    const divider = document.createElement('li');
    divider.className = 'graph-visibility-divider';
    list.appendChild(divider);
    for (const entry of enrichmentEntries) addItem(entry);
  }

  host.appendChild(list);
}
