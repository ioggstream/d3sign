/**
 * The Sources popover: which knowledge bases the query engine holds.
 *
 * Deliberately not part of the Graphs chip. That chip's checkbox means "draw
 * this"; this one means "make this queryable", and a knowledge base is the one
 * thing that must be the second without ever being the first — 130k ontology
 * triples in Cytoscape is not a view (docs/adr/0020-sparql-query-engine.md).
 *
 * The document graphs are listed below, read-only, because "what is in scope"
 * is the question this panel exists to answer and the answer includes them.
 */

const STATE_LABELS = {
  idle: 'not loaded',
  loading: 'loading…',
  ready: 'loaded',
  failed: 'failed',
};

function formatCount(n) {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

function sourceHint(source) {
  if (source.state === 'ready') {
    // The inferred count is worth its own clause: it is the difference between
    // queries seeing the ontology's relations and seeing a fraction of them
    // (queryEngine.js, MATERIALIZE_RESTRICTIONS).
    const parts = [`${formatCount(source.triples)} triples`];
    if (source.inferred) parts.push(`${formatCount(source.inferred)} from OWL restrictions`);
    if (source.ms) parts.push(`loaded in ${Math.round(source.ms)} ms`);
    return parts.join(' · ');
  }
  if (source.state === 'failed') return source.error || 'failed to load';
  if (source.state === 'loading') return 'fetching and parsing…';
  // Before the fetch there is only the manifest's estimate, and the download is
  // the thing worth warning about.
  return `~${formatCount(source.tripleHint)} triples · downloads on demand`;
}

export function renderSourcesPanel(host, sources, documentGraphs, onToggle) {
  host.innerHTML = '';

  const list = document.createElement('ul');
  list.className = 'filter-list sources-list';

  for (const source of sources) {
    const item = document.createElement('li');
    item.title = source.description || '';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = source.state === 'ready' || source.state === 'loading';
    checkbox.disabled = source.state === 'loading';
    checkbox.addEventListener('change', () => onToggle(source.id));

    const label = document.createElement('label');
    label.append(checkbox, document.createTextNode(` ${source.label} `));

    const state = document.createElement('span');
    state.className = `sources-state is-${source.state}`;
    state.textContent = STATE_LABELS[source.state] ?? source.state;

    const hint = document.createElement('span');
    hint.className = 'sources-hint';
    hint.textContent = sourceHint(source);

    item.append(label, state, hint);
    list.append(item);
  }

  host.append(list);

  const heading = document.createElement('p');
  heading.className = 'sources-heading';
  heading.textContent = 'Document graphs (always in scope)';
  host.append(heading);

  const docList = document.createElement('ul');
  docList.className = 'filter-list sources-list sources-list--readonly';
  if (!documentGraphs.length) {
    const empty = document.createElement('li');
    empty.className = 'filter-list-empty';
    empty.textContent = 'no document graphs';
    docList.append(empty);
  }
  for (const graph of documentGraphs) {
    const item = document.createElement('li');
    item.title = graph.description || '';
    const name = document.createElement('span');
    name.textContent = graph.label;
    const hint = document.createElement('span');
    hint.className = 'sources-hint';
    hint.textContent = `${formatCount(graph.quads.length)} triples`;
    item.append(name, hint);
    docList.append(item);
  }
  host.append(docList);

  // The Graphs chip filters the drawing, not the data — and the TriG pane already
  // shows the whole document regardless of it (ADR 0014). Queries follow the pane.
  const note = document.createElement('p');
  note.className = 'sources-note';
  note.textContent = 'Hiding a graph in the Graphs chip changes the drawing, not what queries see.';
  host.append(note);
}
