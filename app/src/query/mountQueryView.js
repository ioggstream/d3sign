/**
 * The SPARQL pane as one mountable unit: the query editor, the library and saved
 * queries, the Sources chip and the results table. The engine and everything
 * host-specific arrive through `shell`, so the SPA and the VS Code webview mount the
 * same code (docs/adr/0043-vscode-extension.md; the pane itself is
 * docs/adr/0020-sparql-query-engine.md and docs/adr/0021-sparql-query-pane.md).
 *
 * shell = {
 *   isActive()                  the pane is on screen (gates Alt+K)
 *   prompt(message, value)      → Promise<string|null>
 *   confirm(message)            → Promise<boolean>
 *   createEngine({ onSourcesChange })   → a query client (query/queryClient.js)
 *   contributions()             the document's named graphs, as the engine is fed them
 *   selectedNode()              → iri | null; what `?this` binds to
 *   drawnNodeIds()              → Set<iri>; only these earn a "show in graph" button
 *   onReveal(iri)               a result row asked to be shown in the graph
 *   onAddGraph(contribution)    → Promise; a CONSTRUCT result became a graph of the document
 *   onLint(message)             a storage error to report
 * }
 */

import { createSparqlPane } from '../editor/editorPane.js';
import { wireCopyButton } from '../clipboard.js';
import { createFilterChip } from '../viz/filterChip.js';
import { curieForGraphName } from '../rdf/emit.js';
import { knowledgeBaseById } from '../rdf/knowledgeBases.js';
import { queryPrefixes, preambleLineCount, withPreamble } from './queryPrefixes.js';
import {
  adjustErrorPosition,
  bindClassPair,
  bindSelection,
  PAIR_PLACEHOLDERS,
  referencedSources,
  resultTable,
  usesThis,
} from './resultModel.js';
import { QUERY_LIBRARY, queryByFileName } from './queryLibrary.js';
import {
  deleteQuery,
  queryById,
  renameQuery,
  saveQueryAs,
  saveQueryOver,
  sortedQueries,
  uniqueName as uniqueQueryName,
} from './queryStore.js';
import { flushQueries, loadQueries, onQueryStorageError, saveQueries } from './queryPersist.js';
import { renderSavedQueries, renderSavedSelect } from './savedQueriesView.js';
import { quadsFromFlat } from './flatQuads.js';
import { renderQueryResults, renderQueryPlaceholder, renderQueryStatus } from './resultsView.js';
import { renderSourcesPanel } from './sourcesPanel.js';
import { makeResizableGutter } from '../layout/resizer.js';

const DEFAULT_QUERY = `# Pick a query from the library, or write your own.
# Prefixes are declared for you; Ctrl+Enter runs.

SELECT ?node ?class WHERE {
  GRAPH ?g { ?node a ?class }
  FILTER(!STRSTARTS(STR(?g), STR(K:)))
}
LIMIT 50
`;

const ALTERNATIVES_QUERY = '15-alternative-links-between.rq';

// Rows rather than columns: the results table wants the full width, and the column
// it usually sits in is the widest one (docs/adr/0021-sparql-query-pane.md). The
// saved-queries list is a plain block above the grid, not a third grid row: the
// pane's row gutter divides the editor from the results and must keep doing
// exactly that.
const MARKUP = `
  <div class="pane-header">
    <h2>SPARQL</h2>
    <div id="query-filter-chips" class="filter-chips"></div>
    <select id="query-select" title="Load a query from the library"></select>
    <select id="saved-query-select" title="Reopen a query saved in this browser"></select>
    <div class="query-tools">
      <button type="button" id="save-query-button" class="copy-button"
              title="Save this query in the browser (Ctrl+S)">Save <span class="tab-key">Ctrl+S</span></button>
      <button type="button" id="toggle-saved-button" class="icon-button" aria-expanded="false"
              title="Show the queries saved in this browser">▤</button>
      <button type="button" id="run-query-button" class="copy-button btn--primary"
              title="Run the query (Ctrl+Enter)">▶ Run <span class="tab-key">Ctrl+Enter</span></button>
      <button type="button" id="cancel-query-button" class="icon-button" hidden
              title="Cancel by restarting the query engine — a running SPARQL query cannot be interrupted">⏹</button>
      <button type="button" id="copy-query-button" class="copy-button"
              title="Copy the query text to the clipboard, without the prefix preamble">Copy</button>
    </div>
  </div>
  <div id="saved-queries" class="saved-queries" hidden></div>
  <div id="query-grid">
    <div id="query-host"></div>
    <div class="gutter gutter-row" id="gutter-query-row"></div>
    <div id="query-results" class="query-results"></div>
  </div>
  <div id="query-status" class="query-status">no query run yet</div>
`;

export function mountQueryView(host, shell) {
  host.innerHTML = MARKUP;
  const $ = (selector) => host.querySelector(selector);
  const queryChipHost = $('#query-filter-chips');
  const queryHost = $('#query-host');
  const queryResultsHost = $('#query-results');
  const queryStatusHost = $('#query-status');
  const querySelect = $('#query-select');
  const runQueryButton = $('#run-query-button');
  const cancelQueryButton = $('#cancel-query-button');
  const copyQueryButton = $('#copy-query-button');
  const savedQuerySelect = $('#saved-query-select');
  const saveQueryButton = $('#save-query-button');
  const toggleSavedButton = $('#toggle-saved-button');
  const savedQueriesHost = $('#saved-queries');

  // In the SPARQL pane's header, not the graph's: its checkbox means "make this
  // queryable", where the Graphs chip's means "draw this". A knowledge base is the
  // one thing that has to be the first without ever being the second
  // (docs/adr/0020-sparql-query-engine.md).
  const sourcesChip = createFilterChip(queryChipHost, {
    id: 'query-sources',
    label: 'Sources',
    icon: '⛁',
    title: 'Knowledge bases in the query engine',
    shortcut: 'Alt+K',
  });

  const queryClient = shell.createEngine({ onSourcesChange: () => renderSources() });

  function renderSources() {
    const sources = queryClient.sources();
    renderSourcesPanel(sourcesChip.body, sources, shell.contributions(), (id) => queryClient.toggleSource(id));
    sourcesChip.setCount(sources.filter((s) => s.state === 'ready').length, sources.length);
  }

  const queryPane = createSparqlPane(queryHost, DEFAULT_QUERY, () => void runQuery(), () => saveCurrentQuery());

  for (const entry of QUERY_LIBRARY) {
    const option = document.createElement('option');
    option.value = entry.fileName;
    option.textContent = entry.title;
    option.title = entry.about;
    querySelect.appendChild(option);
  }
  // No option is selected until one is picked: the box starts on the placeholder so
  // the label never claims the editor holds a library query when it holds the default.
  const libraryPlaceholder = document.createElement('option');
  libraryPlaceholder.value = '';
  libraryPlaceholder.textContent = 'Query library…';
  libraryPlaceholder.selected = true;
  querySelect.prepend(libraryPlaceholder);

  querySelect.addEventListener('change', () => {
    const entry = queryByFileName(querySelect.value);
    if (!entry) return;
    queryPane.setText(entry.sparql, { silent: true });
    // A library entry is not one of the user's saved queries, so a Save that
    // follows must ask for a name rather than overwrite whatever was open.
    setCurrentQuery(null, entry.title);
    if (entry.needsSelection && !shell.selectedNode()) {
      renderQueryStatus(queryStatusHost, `${entry.title} — select a node in the graph first, then Run.`);
    } else if (entry.scope === 'pair') {
      // Picked from the library its two classes are still placeholders, so it
      // would return nothing — and an empty result reads as "no findings"
      // (docs/adr/0020-sparql-query-engine.md). Say where the real pair comes from.
      renderQueryStatus(
        queryStatusHost,
        `${entry.title} — replace ${PAIR_PLACEHOLDERS.source} and ${PAIR_PLACEHOLDERS.target}, ` +
          "or open it from an edge's info panel to have them filled in.",
      );
    } else {
      renderQueryStatus(queryStatusHost, `${entry.title} — Ctrl+Enter to run.`);
    }
  });

  // -------------------------------------------------------------------------
  // Saved queries (docs/adr/0021-sparql-query-pane.md)
  // -------------------------------------------------------------------------

  let queryStoreState = loadQueries();
  onQueryStorageError((reason) => {
    shell.onLint(
      reason === 'quota'
        ? 'Browser storage is full — saved queries are no longer being stored.'
        : 'Browser storage is unavailable — queries cannot be saved.',
    );
  });

  /** The saved query the editor text came from, if it came from one. */
  let currentQueryId = null;
  /** What to seed the name prompt with when the text came from somewhere named. */
  let suggestedQueryName = '';

  function setCurrentQuery(id, suggestion = '') {
    currentQueryId = id;
    if (suggestion) suggestedQueryName = suggestion;
    renderSavedQueryList();
  }

  /**
   * Whether the editor has diverged from the saved query it was opened from.
   *
   * Computed here, on render, rather than tracked: this pane deliberately has no
   * `onChange` — typing must cost nothing — so there is no event to keep a flag
   * up to date with. The list is re-rendered on every interaction that could
   * change the answer, which is when it is looked at anyway.
   */
  function isQueryDirty() {
    const saved = currentQueryId ? queryById(queryStoreState, currentQueryId) : null;
    return saved ? queryPane.getText() !== saved.sparql : false;
  }

  function renderSavedQueryList() {
    renderSavedSelect(savedQuerySelect, queryStoreState, currentQueryId);
    renderSavedQueries(
      savedQueriesHost,
      queryStoreState,
      { currentId: currentQueryId, dirty: isQueryDirty() },
      {
        onOpen: openSavedQuery,
        onOverwrite: (id) => applyQueryResult(saveQueryOver(queryStoreState, id, queryPane.getText())),
        onRename: async (id) => {
          const query = queryById(queryStoreState, id);
          if (!query) return;
          const name = await shell.prompt('Rename the query to:', query.name);
          if (name === null) return;
          applyQueryResult(renameQuery(queryStoreState, id, name));
        },
        onDelete: async (id) => {
          const query = queryById(queryStoreState, id);
          if (!query) return;
          if (!(await shell.confirm(`Delete ${query.name}? This cannot be undone.`))) return;
          // The editor keeps the text; it just stops having a query behind it.
          if (currentQueryId === id) currentQueryId = null;
          applyQueryResult(deleteQuery(queryStoreState, id));
        },
      },
    );
  }

  /**
   * Applies a queryStore result: `{error}` is reported and changes nothing, so a
   * refusal can never leave the list showing queries the storage does not hold.
   */
  function applyQueryResult(result) {
    if (!result || result.error) {
      if (result?.error) renderQueryStatus(queryStatusHost, result.error, { kind: 'error' });
      return null;
    }
    queryStoreState = result.store;
    saveQueries(queryStoreState);
    if (result.query) currentQueryId = result.query.id;
    renderSavedQueryList();
    return result;
  }

  function openSavedQuery(id) {
    const query = queryById(queryStoreState, id);
    if (!query) return;
    queryPane.setText(query.sparql, { silent: true });
    // The library box goes back to its placeholder: the editor no longer holds
    // the library entry it names.
    querySelect.value = '';
    setCurrentQuery(query.id, query.name);
    renderQueryStatus(queryStatusHost, `${query.name} — Ctrl+Enter to run.`);
  }

  /**
   * Save, from the button or Ctrl+S.
   *
   * With a saved query open it overwrites in place, which is what makes refining
   * one cheap; otherwise it asks for a name. Nothing is written by typing — a
   * half-written query is not a question worth keeping.
   */
  async function saveCurrentQuery() {
    const sparql = queryPane.getText();
    if (!sparql.trim()) {
      renderQueryStatus(queryStatusHost, 'There is nothing to save.', { kind: 'error' });
      return;
    }

    const open = currentQueryId ? queryById(queryStoreState, currentQueryId) : null;
    if (open) {
      const saved = applyQueryResult(saveQueryOver(queryStoreState, open.id, sparql));
      if (saved) renderQueryStatus(queryStatusHost, `Saved ${saved.query.name}.`);
      return;
    }

    const suggested = uniqueQueryName(queryStoreState, suggestedQueryName || 'untitled query');
    const name = await shell.prompt('Save this query as:', suggested);
    if (name === null) return;
    const saved = applyQueryResult(saveQueryAs(queryStoreState, name, sparql));
    if (saved) renderQueryStatus(queryStatusHost, `Saved ${saved.query.name}.`);
  }

  savedQuerySelect.addEventListener('change', () => {
    if (savedQuerySelect.value) openSavedQuery(savedQuerySelect.value);
  });
  saveQueryButton.addEventListener('click', () => saveCurrentQuery());
  toggleSavedButton.addEventListener('click', () => {
    const open = savedQueriesHost.hidden;
    savedQueriesHost.hidden = !open;
    toggleSavedButton.setAttribute('aria-expanded', String(open));
    // Rendered on open rather than kept live: `dirty` is a text comparison, and
    // there is no point making it while the list is not on screen.
    if (open) renderSavedQueryList();
  });
  window.addEventListener('beforeunload', () => flushQueries());
  renderSavedQueryList();

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------

  /** Which document graphs the engine last held, so a deleted one gets cleared too. */
  let syncedGraphNames = new Set();
  let queryRunning = false;
  // The quads of the last CONSTRUCT, kept so "Add as graph" has something to add.
  // Flattened terms, not n3 quads — they came across postMessage (query/flatQuads.js).
  let lastConstructQuads = null;

  function setQueryRunning(running) {
    queryRunning = running;
    runQueryButton.disabled = running;
    cancelQueryButton.hidden = !running;
  }

  /**
   * Pushes the document into the engine.
   *
   * Every graph every time, rather than tracking which ones changed: the document is
   * a few hundred quads, this runs on Run and not on a keystroke, and the union with
   * the previously-synced names is what clears a graph the user has since deleted.
   * Dirty-tracking would need threading through three call sites to save under a
   * millisecond.
   */
  async function syncDocumentToEngine() {
    const contributions = shell.contributions();
    const byName = new Map(contributions.map((c) => [c.name, c]));
    const names = new Set([...byName.keys(), ...syncedGraphNames]);
    await queryClient.syncGraphs([...names].map((name) => byName.get(name) ?? { name, quads: [] }));
    syncedGraphNames = new Set(byName.keys());
  }

  async function runQuery() {
    if (queryRunning) return;
    const sparql = queryPane.getText().trim();
    if (!sparql) {
      renderQueryStatus(queryStatusHost, 'Nothing to run.', { kind: 'error' });
      return;
    }

    const selectedNode = shell.selectedNode();
    if (usesThis(sparql) && !selectedNode) {
      renderQueryStatus(queryStatusHost, 'This query is about ?this — select a node in the graph first.', {
        kind: 'error',
      });
      return;
    }

    setQueryRunning(true);
    try {
      // A query naming a knowledge base that is not loaded would return zero rows,
      // which reads as "nothing found". Load it instead of answering wrongly.
      const missing = referencedSources(sparql).filter(
        (id) => knowledgeBaseById(id) && !queryClient.loadedSources().some((kb) => kb.id === id),
      );
      for (const id of missing) {
        renderQueryStatus(queryStatusHost, `Loading ${knowledgeBaseById(id).label}…`, { kind: 'busy' });
        await queryClient.loadSource(id);
      }
      const stillMissing = missing.filter((id) => !queryClient.loadedSources().some((kb) => kb.id === id));
      if (stillMissing.length) {
        renderQueryStatus(queryStatusHost, `Could not load ${stillMissing.join(', ')} — see the Sources chip.`, {
          kind: 'error',
        });
        return;
      }

      const prefixes = queryPrefixes(queryClient.loadedSources());
      renderQueryStatus(queryStatusHost, 'Running…', { kind: 'busy' });
      await syncDocumentToEngine();

      const result = await queryClient.query(
        withPreamble(bindSelection(sparql, selectedNode), prefixes),
      );
      const table = resultTable(result, {
        prefixes,
        // Only what the graph is drawing earns a "show in graph" button.
        knownNodes: shell.drawnNodeIds(),
      });
      lastConstructQuads = table.kind === 'construct' ? result.quads : null;
      renderQueryResults(queryResultsHost, table, {
        onReveal: (iri) => shell.onReveal(iri),
        onAddGraph: table.addableQuads ? addConstructAsGraph : null,
      });
      const sources = queryClient.loadedSources();
      const scope = sources.length ? ` · ${sources.map((s) => curieForGraphName(s.graph)).join(', ')}` : '';
      renderQueryStatus(queryStatusHost, `${table.summary}${scope}`);
    } catch (error) {
      const { message, line } = adjustErrorPosition(error, preambleLineCount(queryPrefixes(queryClient.loadedSources())));
      renderQueryPlaceholder(queryResultsHost, 'No results — the query did not run.');
      renderQueryStatus(queryStatusHost, line ? `Line ${line}: ${message}` : message, { kind: 'error' });
    } finally {
      setQueryRunning(false);
    }
  }

  /**
   * Turns a CONSTRUCT result into a named graph of the document.
   *
   * Nothing else is needed to draw it: the graph view is built from RDF alone
   * (docs/adr/0014-graph-view-from-rdf-only.md), so adding a contribution makes it
   * appear in the Graphs chip, in the TriG pane and in the drawing at once. This is
   * the enrichment path the README promises.
   */
  async function addConstructAsGraph(name) {
    if (!lastConstructQuads?.length) return;
    const slug = name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'enrichment';
    const graphName = `urn:d3fend-graph:query:${slug}`;
    const quads = quadsFromFlat(lastConstructQuads, graphName);
    await shell.onAddGraph({
      name: graphName,
      label: curieForGraphName(graphName),
      description: `Built by a SPARQL CONSTRUCT (${quads.length} triples)`,
      kind: 'query',
      quads,
    });
    renderQueryStatus(queryStatusHost, `Added ${quads.length} triples as ${curieForGraphName(graphName)}.`);
  }

  runQueryButton.addEventListener('click', () => void runQuery());
  cancelQueryButton.addEventListener('click', async () => {
    renderQueryStatus(queryStatusHost, 'Cancelling — restarting the query engine…', { kind: 'busy' });
    await queryClient.cancel();
    setQueryRunning(false);
    renderQueryStatus(queryStatusHost, 'Cancelled. The engine has been restarted.', { kind: 'error' });
  });
  wireCopyButton(copyQueryButton, () => queryPane.getText());
  renderQueryPlaceholder(queryResultsHost, 'Run a query to see results.');

  makeResizableGutter($('#gutter-query-row'), {
    container: $('#query-grid'),
    axis: 'row',
    beforeIndex: 0,
    afterIndex: 2,
    min: 80,
  });

  // Alt+K opens the Sources popover. Keyed on `code`, not `key`: with Alt held some
  // layouts report a composed character instead of the letter.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.code !== 'KeyK' || !shell.isActive()) return;
      event.preventDefault();
      sourcesChip.open();
    },
    true,
  );

  return {
    /**
     * Opens the pane on a query about one node, from the `q` key or the node menu.
     * The graph view has already selected the node, so `?this` is bound to it.
     */
    queryNode(iri) {
      const entry = QUERY_LIBRARY.find((q) => q.needsSelection) ?? null;
      if (entry) {
        queryPane.setText(entry.sparql, { silent: true });
        querySelect.value = entry.fileName;
        setCurrentQuery(null, entry.title);
      }
      renderQueryStatus(
        queryStatusHost,
        `${curieForGraphName(iri)} is bound to ?this — Ctrl+Enter to run.`,
      );
    },

    /**
     * Opens the pane on the two classes an edge connects, from its info panel.
     *
     * The pair is written into the text rather than bound, so the query the user
     * reads is the query that runs and is theirs to widen — which is the point of
     * the button: the panel shows only the tiers that constrain both ends, and
     * relaxing that is a two-line edit the comment in the file spells out.
     * `pair` is null when an end has no `d3f:` class.
     */
    queryClassPair(pair) {
      const entry = queryByFileName(ALTERNATIVES_QUERY);
      if (!entry || !pair) {
        renderQueryStatus(queryStatusHost, 'Both ends of the link need a d3f: class.', { kind: 'error' });
        return;
      }
      queryPane.setText(bindClassPair(entry.sparql, pair), { silent: true });
      querySelect.value = entry.fileName;
      setCurrentQuery(null, entry.title);
      renderQueryStatus(
        queryStatusHost,
        `d3f:${pair.source} → d3f:${pair.target} — Ctrl+Enter to run.`,
      );
    },

    /** Re-renders the Sources popover, which lists the document graphs in query scope. */
    renderSources,
    /** The saved queries, newest first as the store sorts them. */
    savedQueries: () => sortedQueries(queryStoreState),
    requestMeasure: () => queryPane.requestMeasure(),
    focus: () => queryPane.focus(),
    hasFocus: () => queryPane.hasFocus(),
  };
}
