import { LINK_KINDS } from '../rdf/linkKind.js';
import { NODE_KINDS, NODE_KIND_LABELS } from '../rdf/nodeKind.js';
import { renderBulkActions } from './filterChip.js';

function storageKey(diagramId) {
  return `d3fend-graph:filter-state:${diagramId}`;
}

export function loadFilterState(diagramId, allPredicates) {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey(diagramId)) || 'null');
  } catch {
    saved = null;
  }
  const visiblePredicates = new Set(saved?.visiblePredicates ?? allPredicates);
  const direction = new Map(saved?.direction ?? []);
  // A payload saved before a kind existed simply doesn't mention it, which would
  // otherwise read as "the user hid it" and drop those edges forever. `kinds`
  // records the vocabulary in force when the payload was written, so a kind added
  // later defaults to visible while a kind the user actually de-selected stays
  // hidden. Payloads predating `kinds` fall back to their own visibleKinds, which
  // is the same thing for them.
  const visibleKinds = new Set(saved?.visibleKinds ?? LINK_KINDS);
  if (saved?.visibleKinds) {
    const knownWhenSaved = new Set(saved.kinds ?? saved.visibleKinds);
    for (const kind of LINK_KINDS) if (!knownWhenSaved.has(kind)) visibleKinds.add(kind);
  }
  const visibleNodeKinds = new Set(saved?.visibleNodeKinds ?? NODE_KINDS);
  // Folded containers, by IRI. An IRI left over from another example simply
  // matches no node, so nothing has to prune the set when the document changes.
  const foldedNodes = new Set(saved?.foldedNodes ?? []);
  return { visiblePredicates, direction, visibleKinds, visibleNodeKinds, foldedNodes };
}

export function saveFilterState(diagramId, filterState) {
  const payload = {
    visiblePredicates: [...filterState.visiblePredicates],
    direction: [...filterState.direction.entries()],
    visibleKinds: [...filterState.visibleKinds],
    // The kind vocabulary this payload knew about — see loadFilterState.
    kinds: [...LINK_KINDS],
    visibleNodeKinds: [...filterState.visibleNodeKinds],
    foldedNodes: [...filterState.foldedNodes],
  };
  localStorage.setItem(storageKey(diagramId), JSON.stringify(payload));
}

/**
 * Case-insensitive substring match on a panel entry's visible label. Shared by the
 * keyboard filter and its Enter-toggle, so both agree on which entries are "shown".
 */
export function matchesQuery(label, query) {
  const needle = (query ?? '').trim().toLowerCase();
  return !needle || label.toLowerCase().includes(needle);
}

/**
 * Shared body of the link-kind and node-kind panels: a checkbox per kind plus an
 * all/none shortcut in `bulkHost`. `selectionOf` returns the Set on `filterState`
 * being toggled, and `replaceSelection` swaps it wholesale for the bulk actions —
 * one re-render instead of one per kind.
 */
function renderKindPanel(host, {
  kinds,
  labelOf,
  className,
  bulkHost,
  filterState,
  diagramId,
  onFilterChange,
  selectionOf,
  replaceSelection,
  rerender,
  query,
}) {
  if (bulkHost) {
    const setAll = (checked) => {
      replaceSelection(new Set(checked ? kinds : []));
      saveFilterState(diagramId, filterState);
      onFilterChange(filterState);
      rerender();
    };
    renderBulkActions(bulkHost, { onAll: () => setAll(true), onNone: () => setAll(false) });
  }

  const list = document.createElement('ul');
  list.className = `filter-list ${className}`;

  const shown = kinds.filter((kind) => matchesQuery(labelOf(kind), query));
  if (!shown.length) {
    const empty = document.createElement('li');
    empty.className = 'filter-list-empty';
    empty.textContent = 'no match';
    list.appendChild(empty);
  }

  for (const kind of shown) {
    const item = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectionOf().has(kind);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectionOf().add(kind);
      else selectionOf().delete(kind);
      saveFilterState(diagramId, filterState);
      onFilterChange(filterState);
    });

    const label = document.createElement('label');
    label.textContent = ` ${labelOf(kind)} `;
    label.prepend(checkbox);
    item.appendChild(label);
    list.appendChild(item);
  }

  host.appendChild(list);
}

/**
 * Renders the link-kind legend (data-flow / control-flow / other) into
 * `host`, letting the user toggle visibility of each kind. Per-predicate
 * direction inversion happens by clicking a link directly in the graph
 * (see graphPane.js's edge tap handler), not from this panel.
 * `bulkHost` receives the all/none shortcut, which applies every kind at once
 * so a bulk change costs a single re-render.
 * `query` narrows the list to the matching kinds — what the Alt+L keyboard filter
 * renders through.
 */
export function renderFilterPanel(host, diagramId, predicates, filterState, onFilterChange, { bulkHost, query } = {}) {
  host.innerHTML = '';

  // Keep predicates from the current diagram visible by default (visiblePredicates
  // still gates rendering in toCytoscape.js, it's just no longer toggled from this UI).
  for (const p of predicates) {
    if (!filterState.visiblePredicates.has(p) && !filterState._seen?.has(p)) {
      filterState.visiblePredicates.add(p);
    }
  }
  filterState._seen = new Set(predicates);

  renderKindPanel(host, {
    kinds: LINK_KINDS,
    labelOf: (kind) => kind,
    className: 'kind-legend',
    bulkHost,
    filterState,
    diagramId,
    onFilterChange,
    selectionOf: () => filterState.visibleKinds,
    replaceSelection: (next) => {
      filterState.visibleKinds = next;
    },
    rerender: () => renderFilterPanel(host, diagramId, predicates, filterState, onFilterChange, { bulkHost, query }),
    query,
  });
}

/**
 * Flips the visibility of every link kind the query still shows — the Enter action
 * of the Alt+L list. Pressing Enter again undoes it.
 */
export function toggleMatchingLinkKinds(diagramId, filterState, query, onFilterChange) {
  const matching = LINK_KINDS.filter((kind) => matchesQuery(kind, query));
  if (!matching.length) return;
  for (const kind of matching) {
    if (filterState.visibleKinds.has(kind)) filterState.visibleKinds.delete(kind);
    else filterState.visibleKinds.add(kind);
  }
  saveFilterState(diagramId, filterState);
  onFilterChange(filterState);
}

/**
 * Renders the node-kind filter (Artifacts / Actors / Tactical / Other) into
 * `host`. Buckets come from nodeKind.js and group the same D3FENDCore branches
 * the node colours are keyed on.
 */
export function renderNodeFilterPanel(host, diagramId, filterState, onFilterChange, { bulkHost } = {}) {
  host.innerHTML = '';

  renderKindPanel(host, {
    kinds: NODE_KINDS,
    labelOf: (kind) => NODE_KIND_LABELS[kind],
    className: 'node-kind-legend',
    bulkHost,
    filterState,
    diagramId,
    onFilterChange,
    selectionOf: () => filterState.visibleNodeKinds,
    replaceSelection: (next) => {
      filterState.visibleNodeKinds = next;
    },
    rerender: () => renderNodeFilterPanel(host, diagramId, filterState, onFilterChange, { bulkHost }),
  });
}

/**
 * Folds or unfolds the container `iri`, persists it, and re-renders the graph.
 * Fold state is view state like the filters — the RDF store never sees it, so
 * folding cannot change the TriG (docs/adr/0012-fold-container-nodes.md).
 */
export function toggleFold(diagramId, filterState, iri, onFilterChange) {
  if (filterState.foldedNodes.has(iri)) filterState.foldedNodes.delete(iri);
  else filterState.foldedNodes.add(iri);
  saveFilterState(diagramId, filterState);
  onFilterChange(filterState);
}

/** Flips the forward/inverse direction for `predicate`, persists it, and re-renders the graph. */
export function invertPredicateDirection(diagramId, filterState, predicate, onFilterChange) {
  const next = (filterState.direction.get(predicate) || 'forward') === 'forward' ? 'inverse' : 'forward';
  filterState.direction.set(predicate, next);
  saveFilterState(diagramId, filterState);
  onFilterChange(filterState);
}
