import {
  createEditorPane,
  createTurtlePane,
  createSparqlPane,
  applyEditorFontSize,
} from './editor/editorPane.js';
import { mermaidIdOf, writtenTriplesOf } from './goToSource.js';
import { parseDocument } from './parser/document.js';
import { emitQuads, curieForGraphName } from './rdf/emit.js';
import { GraphStore } from './rdf/store.js';
import { buildGraphModel, modelPredicates } from './rdf/graphModel.js';
import { toTurtle } from './rdf/serialize.js';
import { renderMermaidPreview } from './mermaidPreview/previewPane.js';
import { createGraphPane } from './viz/graphPane.js';
import {
  loadFilterState,
  renderFilterPanel,
  renderNodeFilterPanel,
  invertPredicateDirection,
  toggleFold,
  toggleMatchingLinkKinds,
} from './viz/filterPanel.js';
import {
  loadVisibleGraphs,
  saveVisibleGraphs,
  renderGraphPanel,
  graphMatchesQuery,
} from './viz/graphVisibility.js';
import { createFilterChip } from './viz/filterChip.js';
import { loadPrefs, savePrefs } from './viz/graphPrefs.js';
import { renderPrefsPanel } from './viz/prefsPanel.js';
import { renderDiagramList } from './viz/diagramList.js';
import { LAYOUTS, DEFAULT_LAYOUT_ID } from './viz/layouts.js';
import { applyPanelFontSize, closeNodePanel, renderNodePanel } from './viz/nodePanel.js';
import { renderEdgePanel } from './viz/edgePanel.js';
import { renderSelectionBox } from './viz/selectionBox.js';
import { loadEnrichmentTurtle, ENRICHMENT_GRAPH } from './rdf/enrichment.js';
import { parseTrigText } from './rdf/parseTrig.js';
import { createColumnLayout } from './layout/columns.js';
import { wireCopyButton } from './clipboard.js';
import {
  currentFile,
  deleteFile,
  duplicateFile,
  fileById,
  importFile,
  isDirty,
  openFile,
  openScratch,
  renameFile,
  saveAs,
  saveOver,
  setWorkingContent,
  uniqueName,
} from './files/fileStore.js';
import { flushStore, loadStore, onStorageError, saveStore, saveWorking } from './files/filesPersist.js';
import { renderFilesPane } from './files/filesPane.js';
import { downloadText, pickTextFile } from './files/fileTransfer.js';
import { makeResizableGutter } from './layout/resizer.js';
import { createQueryClient } from './query/queryClient.js';
import { queryPrefixes, preambleLineCount, withPreamble } from './query/queryPrefixes.js';
import {
  adjustErrorPosition,
  bindSelection,
  referencedSources,
  resultTable,
  usesThis,
} from './query/resultModel.js';
import { QUERY_LIBRARY, queryByFileName } from './query/queryLibrary.js';
import { quadsFromFlat } from './query/flatQuads.js';
import { renderQueryResults, renderQueryPlaceholder, renderQueryStatus } from './query/resultsView.js';
import { renderSourcesPanel } from './query/sourcesPanel.js';
import { knowledgeBaseById } from './rdf/knowledgeBases.js';
import wellKnownAuthFlows from './data/enrichment/well-known-auth-flows.ttl?raw';

const DEFAULT_DIAGRAM_ID = 'current';
const UNION_FILTER_KEY = '__union__';

const exampleModules = import.meta.glob('./data/examples/*.md', { query: '?raw', import: 'default', eager: true });
const examples = Object.keys(exampleModules)
  .sort()
  .map((path) => {
    const content = exampleModules[path];
    // The dropdown lists files, so the entry is the file name. A document holds
    // several diagrams, and the first one's `title:` frontmatter does not name
    // the file — it only gets to be the tooltip.
    const titleMatch = /^title:\s*(.+)$/m.exec(content);
    const fileName = path.split('/').pop();
    return { name: fileName.replace(/\.md$/, ''), fileName, title: titleMatch?.[1].trim() ?? '', content };
  });

const editorHost = document.getElementById('editor-host');
const mermaidHost = document.getElementById('mermaid-host');
const diagramListHost = document.getElementById('diagram-list-host');
const turtleHost = document.getElementById('turtle-host');
const turtleDirtyBadge = document.getElementById('turtle-dirty');
const regenerateTurtleButton = document.getElementById('regenerate-turtle-button');
const filesHost = document.getElementById('files-host');
const filesDirtyBadge = document.getElementById('files-dirty');
const fileSaveAsButton = document.getElementById('file-save-as-button');
const fileImportButton = document.getElementById('file-import-button');
const fileExportButton = document.getElementById('file-export-button');
const fileImportInput = document.getElementById('file-import-input');
const filterChipHost = document.getElementById('graph-filter-chips');
const cyHost = document.getElementById('cy-host');
const nodePanelHost = document.getElementById('node-panel');
const selectionBoxHost = document.getElementById('graph-selection');
const lintMessage = document.getElementById('lint-message');
const copyEditorButton = document.getElementById('copy-editor-button');
const copyTurtleButton = document.getElementById('copy-turtle-button');
const queryChipHost = document.getElementById('query-filter-chips');
const queryHost = document.getElementById('query-host');
const queryResultsHost = document.getElementById('query-results');
const queryStatusHost = document.getElementById('query-status');
const querySelect = document.getElementById('query-select');
const runQueryButton = document.getElementById('run-query-button');
const cancelQueryButton = document.getElementById('cancel-query-button');
const copyQueryButton = document.getElementById('copy-query-button');

// Typing narrows the list; Enter flips the visibility of everything still listed,
// so a graph can be shown or hidden without touching the mouse (Alt+T opens it).
let graphQuery = '';
const graphsChip = createFilterChip(filterChipHost, {
  id: 'graphs-filter',
  label: 'Graphs',
  icon: '◆',
  title: 'Named graphs',
  shortcut: 'Alt+T',
  search: {
    placeholder: 'Filter graphs, Enter toggles',
    onInput: (query) => {
      graphQuery = query;
      renderGraphsPanel();
    },
    onSubmit: () => toggleMatchingGraphs(),
  },
});
const nodesChip = createFilterChip(filterChipHost, {
  id: 'nodes-filter',
  label: 'Nodes',
  icon: '●',
  title: 'Node kinds',
  shortcut: 'Alt+N',
});
let linkQuery = '';
const linksChip = createFilterChip(filterChipHost, {
  id: 'links-filter',
  label: 'Links',
  icon: '⇄',
  title: 'Link kinds',
  shortcut: 'Alt+L',
  search: {
    placeholder: 'Filter links, Enter toggles',
    onInput: (query) => {
      linkQuery = query;
      renderLinksPanel();
    },
    onSubmit: () => {
      toggleMatchingLinkKinds(UNION_FILTER_KEY, filterState, linkQuery, onFilterChange);
      renderLinksPanel();
    },
  },
});

// How the graph draws itself: view state, like the filters, so it never reaches
// the store. Loaded before the pane so the first render already honours it.
let prefs = loadPrefs();
// The info panel is a modal outside the pane, so setPrefs cannot reach it: its
// text size is applied to the shared <dialog> directly, here and on every change.
applyPanelFontSize(nodePanelHost, prefs.panelFontSize);
// Likewise the editors: CSS sizes them, so this runs before they are built and
// their first measurement already reads the saved size.
applyEditorFontSize(prefs.editorFontSize);
const prefsChip = createFilterChip(filterChipHost, {
  id: 'prefs',
  label: 'View',
  icon: '⚙',
  title: 'Visualization preferences',
  shortcut: 'Alt+V',
});

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

const queryClient = createQueryClient({ onSourcesChange: () => renderSourcesChip() });

function renderSourcesChip() {
  const sources = queryClient.sources();
  const documentGraphs = [...graphContributions.values()];
  renderSourcesPanel(sourcesChip.body, sources, documentGraphs, (id) => queryClient.toggleSource(id));
  sourcesChip.setCount(sources.filter((s) => s.state === 'ready').length, sources.length);
}

// The element the keyboard acts on, as the graph pane reports it (viz/graphPane.js):
// `{ kind: 'node' | 'edge', … }`, or null. Declared before the pane, which reports
// into it. The kind is what the shortcut table below dispatches on — `f` means
// nothing on an edge, `s` means nothing on a node.
let selection = null;
let pathFocus = null;

function setPathFocus(direction, nodeId = selection?.id) {
  if (!nodeId) return;
  const active = graphPane.setPathFocus(nodeId, direction);
  pathFocus = active ? { nodeId, direction } : null;
}

function clearPathFocus() {
  if (!pathFocus) return false;
  graphPane.clearPathFocus();
  pathFocus = null;
  return true;
}

/*
 * Navigation back to the source is resolved here rather than carried through the
 * pipeline: the view knows nothing about mermaid, so the shell reverses the
 * identifiers and the editor looks them up in its own live text
 * (docs/adr/0017-go-to-mermaid-source.md).
 *
 * Function declarations, so they can be named in the pane's options above the line
 * where `editorPane` is created — they only run once something is clicked.
 */

/** Whether `iri` came from the diagram and the editor can still find it. */
function canGoToMermaidSource(iri) {
  const id = mermaidIdOf(iri);
  return Boolean(id) && editorPane.hasSource(id);
}

function goToMermaidSource(iri) {
  const id = mermaidIdOf(iri);
  if (id) editorPane.revealSource(id);
}

/**
 * The same two questions for an edge, which stands for one or more written triples
 * — several when a fold has collapsed a group of links into one arrow.
 *
 * The jump re-asks the question rather than trusting the caller to have asked it:
 * three places reach it now (the menu, `g`, the edge panel) and only the menu is
 * built from the answer.
 */
function canGoToEdgeMermaidSource(data) {
  return editorPane.hasEdgeSource(writtenTriplesOf(data, filterState));
}

function goToEdgeMermaidSource(data) {
  const keys = writtenTriplesOf(data, filterState);
  if (editorPane.hasEdgeSource(keys)) editorPane.revealEdgeSource(keys);
}

/**
 * What the info panel may do to the diagram. Empty for a node the diagram did
 * not write — a d3f: class, an enrichment resource, an IRI typed in the TriG
 * pane — which is what keeps the "+" off rows there is nothing to attach to
 * (docs/adr/0018-add-defensive-measure.md).
 */
function nodePanelActions(nodeData) {
  const id = mermaidIdOf(nodeData.id);
  if (!id || !editorPane.hasSource(id)) return {};
  return { onAddRelation: (rel) => editorPane.addRelation(id, rel) };
}

/**
 * What the edge panel may do. Empty for an edge with no mermaid origin — an
 * enrichment triple, or one typed into the TriG pane — which is what keeps the
 * button off a panel that could not honour it.
 *
 * The panel closes on the way out: it is a modal, so leaving it open over the
 * editor would hide the very line it just jumped to.
 */
function edgePanelActions(edgeData) {
  if (!canGoToEdgeMermaidSource(edgeData)) return {};
  return {
    onGoToSource: () => {
      closeNodePanel(nodePanelHost);
      goToEdgeMermaidSource(edgeData);
    },
  };
}

/**
 * Flips which way every edge of `predicate` is drawn, and renames it to its inverse.
 *
 * Per-predicate and global, not per-edge: this is the same state the Links panel's
 * direction toggle writes, so the two cannot disagree about which way a relation is
 * being read (docs/adr/0019-select-and-swap-edges.md).
 */
function swapPredicateDirection(predicate) {
  invertPredicateDirection(UNION_FILTER_KEY, filterState, predicate, (nextState) => {
    filterState = nextState;
    renderGraph();
  });
}

const store = new GraphStore();
const graphPane = createGraphPane(cyHost, {
  prefs,
  // The info panel is a modal, so it is a menu action rather than a click: a left
  // click selects instead (docs/adr/0008-show-node.md).
  onShowInfo: (nodeData) =>
    renderNodePanel(nodePanelHost, nodeData, store, nodePanelActions(nodeData)),
  // Edges answer the same gesture as nodes, now that a tap on one only selects
  // (docs/adr/0019-select-and-swap-edges.md). Same host, so only one panel can be
  // open and `isGraphShortcutContext` keeps guarding on the one `.open`.
  onShowEdgeInfo: (edgeData) => renderEdgePanel(nodePanelHost, edgeData, edgePanelActions(edgeData)),
  onSelectionChange: (next) => {
    selection = next;
    renderSelectionBox(selectionBoxHost, next);
  },
  onShowOutgoingFlow: (nodeId) => setPathFocus('outgoing', nodeId),
  onShowIncomingFlow: (nodeId) => setPathFocus('incoming', nodeId),
  onSwapDirection: swapPredicateDirection,
  onQuery: (iri) => queryNode(iri),
  // Folding is view state, so it goes through the same filter path as everything
  // else in this header: the store is untouched and the TriG never moves.
  onFoldToggle: (iri) => toggleFold(UNION_FILTER_KEY, filterState, iri, onFilterChange),

  // Named rather than inline, because the `g` shortcut asks the same two questions
  // of the selected element and must not answer them differently.
  canGoToSource: canGoToMermaidSource,
  onGoToSource: goToMermaidSource,
  canGoToEdgeSource: canGoToEdgeMermaidSource,
  onGoToEdgeSource: goToEdgeMermaidSource,
});

// The view model, rebuilt from the store's quads whenever they change. Filter
// changes re-render from this same model without touching the store.
let currentModel = { nodes: new Map(), edges: [], containment: new Map(), parentOf: new Map() };
// Loaded rather than hand-built, so the very first render (triggered by
// applyGraphVisibility before the diagram's predicates are known) already has the
// complete shape, including visibleKinds and visibleNodeKinds.
let filterState = loadFilterState(UNION_FILTER_KEY, []);
let enrichmentLoaded = false;
let diagrams = [];
let selectedHash = null;
let knownGraphNames = new Set();
let graphContributions = new Map();
let visibleGraphs = new Set();
let allPredicates = [];
// Set once the TriG pane has been hand-edited: from then on mermaid edits still
// drive the graph, but they stop rewriting the pane behind the user's back.
let turtleDirty = false;

/** Every filter panel reports here, and renderGraph() is where the chip counts come from. */
function onFilterChange(nextState) {
  filterState = nextState;
  renderGraph();
}

/**
 * Re-renders the Links popover alone, honouring its search query. The query is
 * view state: it narrows what the panel lists, never what the graph shows.
 */
function renderLinksPanel() {
  renderFilterPanel(linksChip.body, UNION_FILTER_KEY, allPredicates, filterState, onFilterChange, {
    bulkHost: linksChip.bulkHost,
    query: linkQuery,
  });
}

/**
 * Redraws the graph view from the current union of visible graphs, and refreshes
 * the Nodes/Links chip counts from what the render actually produced.
 */
function renderGraph() {
  const stats = graphPane.update(currentModel, filterState);
  if (pathFocus && !graphPane.hasPathFocus()) pathFocus = null;
  nodesChip.setCount(stats.nodesShown, stats.nodesTotal);
  linksChip.setCount(stats.edgesShown, stats.edgesTotal);
}

// The panel keeps its own copy of the preferences, so it is rendered once —
// re-rendering it while a slider is being dragged would swap the input away.
renderPrefsPanel(prefsChip.body, prefs, (next) => {
  // Every other preference only changes how the drawing looks, which setPrefs
  // handles by restyling. This one changes which elements exist, so the drawing and
  // the chip counts both have to come from a fresh build
  // (docs/adr/0026-collapse-artifact-mediated-paths.md).
  const rebuild = next.collapseArtifactPaths !== prefs.collapseArtifactPaths;
  prefs = next;
  savePrefs(next);
  graphPane.setPrefs(next);
  applyPanelFontSize(nodePanelHost, next.panelFontSize);
  applyEditorFontSize(next.editorFontSize);
  // CodeMirror caches character metrics: without this the new size wraps and
  // places the caret against the old one until something else forces a measure.
  editorPane.requestMeasure();
  turtlePane.requestMeasure();
  queryPane.requestMeasure();
  if (rebuild) renderGraph();
}, { bulkHost: prefsChip.bulkHost });

function showLint(message) {
  if (message) {
    lintMessage.textContent = message;
    lintMessage.hidden = false;
  } else {
    lintMessage.hidden = true;
  }
}

async function ensureEnrichment() {
  if (enrichmentLoaded) return;
  const quads = loadEnrichmentTurtle(wellKnownAuthFlows);
  graphContributions.set(ENRICHMENT_GRAPH, {
    name: ENRICHMENT_GRAPH,
    label: curieForGraphName(ENRICHMENT_GRAPH),
    description: 'Enrichment: well-known auth flows',
    kind: 'enrichment',
    quads,
  });
  enrichmentLoaded = true;
}

/**
 * Syncs the store with the currently-visible graphs and rebuilds the view model
 * from it. The store is the only input to the model, so hiding a graph removes
 * its nodes and edges without any bookkeeping on the diagram side. The TriG pane
 * is the exception: it shows the whole document regardless of visibility.
 *
 * `writeTurtle: false` is for changes that came *from* that pane — rewriting it
 * under the caret would fight the user.
 */
async function applyGraphVisibility({ writeTurtle = true } = {}) {
  for (const contribution of graphContributions.values()) {
    const isVisible = visibleGraphs.has(contribution.name);
    store.replaceGraph(contribution.name, isVisible ? contribution.quads : []);
  }
  currentModel = buildGraphModel(store);

  if (writeTurtle && !turtleDirty) await renderTurtle();

  renderGraphsPanel();
  // The Sources popover lists the document graphs that are in query scope, so it
  // goes stale on the same events the Graphs one does. The engine is *not* synced
  // here: that happens on Run (docs/adr/0020-sparql-query-engine.md).
  renderSourcesChip();

  renderGraph();
}

/**
 * Serializes every contribution into the TriG pane — the whole document, not the
 * store, since the Graphs chip filters the view and not the data.
 */
async function renderTurtle() {
  const allQuads = [...graphContributions.values()].flatMap((c) => c.quads);
  turtlePane.setText(await toTurtle(allQuads), { silent: true });
}

/** Hand-edited TriG is never overwritten silently; the badge is the reconciliation cue. */
function setTurtleDirty(dirty, label = 'edited') {
  turtleDirty = dirty;
  turtleDirtyBadge.hidden = !dirty;
  turtleDirtyBadge.textContent = label;
  regenerateTurtleButton.hidden = !dirty;
}

/**
 * Applies hand-edited TriG. The pane holds the whole document, so the parsed
 * graphs replace the contributions wholesale — a deleted block is a deleted
 * graph. Invalid text changes nothing: an editor is half-typed most of the time.
 */
function handleTurtleChange(text) {
  const { graphs, error } = parseTrigText(text);
  if (error) {
    showLint(`TriG parse error: ${error.message}`);
    return;
  }

  const previous = graphContributions;
  graphContributions = new Map();
  for (const [name, quads] of graphs) {
    const before = previous.get(name);
    graphContributions.set(name, {
      name,
      label: before?.label ?? curieForGraphName(name),
      description: before?.description ?? 'hand-edited RDF',
      kind: before?.kind ?? 'manual',
      quads,
    });
  }
  // Graphs dropped from the text leave the store too — their contribution is gone.
  for (const name of previous.keys()) {
    if (!graphContributions.has(name)) store.replaceGraph(name, []);
  }
  // Recomputed, never saved: saveVisibleGraphs() prunes hidden names that are
  // absent from the document, and a graph the user is mid-way through retyping
  // would lose its hidden flag and pop back into view.
  visibleGraphs = loadVisibleGraphs([...graphContributions.keys()]);

  showLint(null);
  setTurtleDirty(true);
  applyGraphVisibility({ writeTurtle: false });
}

/**
 * Re-renders the Graphs popover alone. Typing in its search box changes nothing
 * in the store, so filtering must not go through applyGraphVisibility().
 */
function renderGraphsPanel() {
  renderGraphPanel(
    graphsChip.body,
    [...graphContributions.values()],
    visibleGraphs,
    (name, checked) => {
      if (checked) visibleGraphs.add(name);
      else visibleGraphs.delete(name);
      saveVisibleGraphs(visibleGraphs, graphContributions.keys());
      applyGraphVisibility();
    },
    {
      bulkHost: graphsChip.bulkHost,
      onSetAll: (checked) => {
        visibleGraphs = new Set(checked ? graphContributions.keys() : []);
        saveVisibleGraphs(visibleGraphs, graphContributions.keys());
        applyGraphVisibility();
      },
      query: graphQuery,
    },
  );
  graphsChip.setCount(visibleGraphs.size, graphContributions.size);
}

/**
 * Flips the visibility of every graph the current search query still shows —
 * the Enter action of the Alt+T list. Pressing Enter again undoes it.
 */
function toggleMatchingGraphs() {
  const matching = [...graphContributions.values()].filter((entry) => graphMatchesQuery(entry, graphQuery));
  if (!matching.length) return;
  for (const entry of matching) {
    if (visibleGraphs.has(entry.name)) visibleGraphs.delete(entry.name);
    else visibleGraphs.add(entry.name);
  }
  saveVisibleGraphs(visibleGraphs, graphContributions.keys());
  applyGraphVisibility();
}

async function handleTextChange(text) {
  // Autosave. This rides the editor's own change debounce and its blur flush, so
  // there is nothing here that has to know about typing rhythm
  // (docs/adr/0023-browser-local-file-store.md).
  const nextStore = setWorkingContent(fileStoreState, text);
  if (nextStore !== fileStoreState) {
    fileStoreState = nextStore;
    saveWorking(fileStoreState);
    renderFiles();
  }

  const { diagrams: newDiagrams, warnings } = parseDocument(text, { defaultDiagramId: DEFAULT_DIAGRAM_ID });
  diagrams = newDiagrams;

  // Every id carrying a class anywhere in the document, in any vocabulary a diagram
  // may write (TYPING_PREFIXES in rdf/emit.js) — a `dpv:`-only subgraph is as tagged
  // as a `d3f:` one, and contains its children the same way. A node id denotes one
  // RDF resource whatever block or named graph mentions it, so tagging it once
  // tags it everywhere — which is how a subgraph re-opened without a title
  // (db-replica.md) keeps containing its children instead of being read as
  // presentational padding. See docs/adr/0003-diagram-to-trig.md.
  const taggedIds = new Set();
  for (const d of diagrams) {
    for (const n of d.ast.nodes) if (n.classes.length) taggedIds.add(n.id);
    for (const s of d.ast.subgraphs) if (s.classes.length) taggedIds.add(s.id);
  }

  const nextDiagramGraphNames = new Set();
  const mergedByGraphName = new Map();
  for (const d of diagrams) {
    const { quads, graphName } = emitQuads(d.ast, d.diagramId, { taggedIds });
    nextDiagramGraphNames.add(graphName);
    if (!mergedByGraphName.has(graphName)) {
      mergedByGraphName.set(graphName, { diagramId: null, quads: [] });
    }
    const merged = mergedByGraphName.get(graphName);
    merged.diagramId = d.diagramId;
    merged.quads = merged.quads.concat(quads);
  }
  for (const [graphName, merged] of mergedByGraphName) {
    graphContributions.set(graphName, {
      name: graphName,
      label: curieForGraphName(graphName),
      description: merged.diagramId,
      kind: 'diagram',
      quads: merged.quads,
    });
  }
  for (const stale of knownGraphNames) {
    if (!nextDiagramGraphNames.has(stale)) {
      graphContributions.delete(stale);
      store.replaceGraph(stale, []);
    }
  }
  knownGraphNames = nextDiagramGraphNames;

  await ensureEnrichment();
  visibleGraphs = loadVisibleGraphs([...graphContributions.keys()]);

  const allWarnings = [...warnings, ...diagrams.flatMap((d) => d.ast.warnings)];
  showLint(allWarnings.length ? allWarnings.join(' ') : null);

  await applyGraphVisibility();
  // The pane was left as the user typed it, so say why it no longer matches.
  if (turtleDirty) setTurtleDirty(true, 'edited — mermaid changed since');

  allPredicates = modelPredicates(currentModel);
  filterState = loadFilterState(UNION_FILTER_KEY, allPredicates);
  renderLinksPanel();
  renderNodeFilterPanel(nodesChip.body, UNION_FILTER_KEY, filterState, onFilterChange, {
    bulkHost: nodesChip.bulkHost,
  });

  renderGraph();

  if (!diagrams.some((d) => d.hash === selectedHash)) {
    selectedHash = diagrams[0]?.hash ?? null;
  }
  renderDiagramList(diagramListHost, diagrams, selectedHash, (hash) => {
    selectedHash = hash;
    renderSelectedPreview();
  });
  renderSelectedPreview();
}

function renderSelectedPreview() {
  const selected = diagrams.find((d) => d.hash === selectedHash);
  // Render errors are reported inside the preview pane itself; the header lint
  // banner stays reserved for TriG/parser problems.
  renderMermaidPreview(mermaidHost, selected ? selected.source : '');
}

const defaultExample = examples.find((e) => e.name === '001-layers') ?? examples[0];

// The browser-local library (docs/adr/0023-browser-local-file-store.md). Read
// synchronously, which is why it is localStorage and not IndexedDB: the editor
// is constructed with its text below and fires its first onChange there.
let fileStoreState = loadStore();
onStorageError((reason) => {
  showLint(
    reason === 'quota'
      ? 'Browser storage is full — document changes are no longer being saved.'
      : 'Browser storage is unavailable — document changes are not being saved.',
  );
});
// Nothing stored yet: the example is what the user gets, and it is not their
// unsaved work, so it goes in as a pristine scratch document.
if (!fileStoreState.working.content) {
  fileStoreState = openScratch(fileStoreState, defaultExample.content);
  saveWorking(fileStoreState);
}
const initialText = fileStoreState.working.content;

// Mounted before the mermaid editor, whose createEditorPane() fires its first
// onChange synchronously and expects a TriG pane to write into.
const turtlePane = createTurtlePane(turtleHost, '', handleTurtleChange);
const editorPane = createEditorPane(editorHost, initialText, handleTextChange);
wireCopyButton(copyEditorButton, () => editorPane.getText());
wireCopyButton(copyTurtleButton, () => turtlePane.getText());

/**
 * Applies a fileStore result: `{error}` is reported and changes nothing, so a
 * refusal can never leave the pane showing a library the storage does not hold.
 */
function applyFileResult(result, { structural = true } = {}) {
  if (!result || result.error) {
    if (result?.error) showLint(result.error);
    return null;
  }
  fileStoreState = result.store;
  if (structural) saveStore(fileStoreState);
  else saveWorking(fileStoreState);
  renderFiles();
  return result;
}

function renderFiles() {
  filesDirtyBadge.hidden = !isDirty(fileStoreState);
  renderFilesPane(filesHost, fileStoreState, {
    onOpen: (id) => {
      if (!confirmDiscard()) return;
      const result = applyFileResult(openFile(fileStoreState, id), { structural: false });
      // Not silent: opening a document has to rerun the whole pipeline, so the
      // graph, the TriG pane and the preview follow the editor.
      if (result) editorPane.setText(result.content);
    },
    onSave: (id) => applyFileResult(saveOver(fileStoreState, id, editorPane.getText())),
    onDuplicate: (id) => applyFileResult(duplicateFile(fileStoreState, id)),
    onRename: (id) => {
      const file = fileById(fileStoreState, id);
      const name = window.prompt('Rename to', file?.name ?? '');
      if (name === null) return;
      applyFileResult(renameFile(fileStoreState, id, name));
    },
    onExport: (id) => {
      const file = fileById(fileStoreState, id);
      if (file) downloadText(file.name, file.content);
    },
    onDelete: (id) => {
      const file = fileById(fileStoreState, id);
      if (file && !window.confirm(`Delete ${file.name}? This cannot be undone.`)) return;
      applyFileResult(deleteFile(fileStoreState, id));
    },
  });
}

/**
 * Asks before replacing the working copy with something else. Only work that no
 * file holds is worth a prompt — a document saved, or freshly loaded and
 * untouched, is reproducible.
 */
function confirmDiscard() {
  if (!isDirty(fileStoreState)) return true;
  return window.confirm('The current document has unsaved changes. Discard them?');
}

fileSaveAsButton.addEventListener('click', () => {
  const suggested = uniqueName(fileStoreState, currentFile(fileStoreState)?.name ?? 'document.md');
  const name = window.prompt('Save the current document as', suggested);
  if (name === null) return;
  applyFileResult(saveAs(fileStoreState, name, editorPane.getText()));
});

fileExportButton.addEventListener('click', () => {
  downloadText(currentFile(fileStoreState)?.name ?? 'document.md', editorPane.getText());
});

fileImportButton.addEventListener('click', async () => {
  const picked = await pickTextFile(fileImportInput);
  if (!picked) return;
  if (!confirmDiscard()) return;
  const result = applyFileResult(importFile(fileStoreState, picked.name, picked.text));
  if (result) editorPane.setText(picked.text);
});

// A timer cannot fire during unload, so the last keystrokes would otherwise be
// the ones that are lost — which is exactly what this feature exists to prevent.
window.addEventListener('beforeunload', () => flushStore());

regenerateTurtleButton.addEventListener('click', async () => {
  setTurtleDirty(false);
  showLint(null);
  // The mermaid source is authoritative again, so re-run it: the pane may have
  // deleted graphs that the diagrams still declare.
  await handleTextChange(editorPane.getText());
});

const exampleSelect = document.getElementById('example-select');
for (const example of examples) {
  const option = document.createElement('option');
  option.value = example.name;
  option.textContent = example.fileName;
  if (example.title) option.title = example.title;
  if (example.name === defaultExample.name) option.selected = true;
  exampleSelect.appendChild(option);
}
let selectedExample = defaultExample.name;
exampleSelect.addEventListener('change', () => {
  const example = examples.find((e) => e.name === exampleSelect.value);
  if (!example) return;
  // Loading an example replaces the working copy — forking it is what "Save as…"
  // is for — so unsaved work gets a say first.
  if (!confirmDiscard()) {
    exampleSelect.value = selectedExample;
    return;
  }
  selectedExample = example.name;
  applyFileResult({ store: openScratch(fileStoreState, example.content) }, { structural: false });
  editorPane.setText(example.content);
});

const layoutSelect = document.getElementById('layout-select');
for (const layout of LAYOUTS) {
  const option = document.createElement('option');
  option.value = layout.id;
  option.textContent = layout.hierarchical ? layout.label : `${layout.label} (flat)`;
  if (layout.id === DEFAULT_LAYOUT_ID) option.selected = true;
  layoutSelect.appendChild(option);
}
layoutSelect.addEventListener('change', () => graphPane.setLayout(layoutSelect.value));

document.getElementById('rotate-cw').addEventListener('click', () => graphPane.rotate(1));
document.getElementById('rotate-ccw').addEventListener('click', () => graphPane.rotate(-1));

// ---------------------------------------------------------------------------
// SPARQL pane (docs/adr/0020-sparql-query-engine.md, docs/adr/0021-sparql-query-pane.md)
// ---------------------------------------------------------------------------

const DEFAULT_QUERY = `# Pick a query from the library, or write your own.
# Prefixes are declared for you; Ctrl+Enter runs.

SELECT ?node ?class WHERE {
  GRAPH ?g { ?node a ?class }
  FILTER(!STRSTARTS(STR(?g), STR(K:)))
}
LIMIT 50
`;

const queryPane = createSparqlPane(queryHost, DEFAULT_QUERY, () => void runQuery());

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
  if (entry.needsSelection && selection?.kind !== 'node') {
    renderQueryStatus(queryStatusHost, `${entry.title} — select a node in the graph first, then Run.`);
  } else {
    renderQueryStatus(queryStatusHost, `${entry.title} — Ctrl+Enter to run.`);
  }
});

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
  const contributions = [...graphContributions.values()];
  const names = new Set([...contributions.map((c) => c.name), ...syncedGraphNames]);
  await queryClient.syncGraphs(
    [...names].map((name) => graphContributions.get(name) ?? { name, quads: [] }),
  );
  syncedGraphNames = new Set(contributions.map((c) => c.name));
}

async function runQuery() {
  if (queryRunning) return;
  const sparql = queryPane.getText().trim();
  if (!sparql) {
    renderQueryStatus(queryStatusHost, 'Nothing to run.', { kind: 'error' });
    return;
  }

  const selectedNode = selection?.kind === 'node' ? selection.id : null;
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
      knownNodes: new Set(currentModel.nodes.keys()),
    });
    lastConstructQuads = table.kind === 'construct' ? result.quads : null;
    renderQueryResults(queryResultsHost, table, {
      onReveal: revealNodeFromQuery,
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

/** Jumps from a result cell to the node it names. */
function revealNodeFromQuery(iri) {
  dock.revealView('graph');
  // After the reveal: cytoscape cannot centre on a node in a hidden container.
  if (!graphPane.selectNode(iri)) {
    graphPane.flashError('That node is hidden by a filter or folded away');
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
  graphContributions.set(graphName, {
    name: graphName,
    label: curieForGraphName(graphName),
    description: `Built by a SPARQL CONSTRUCT (${quads.length} triples)`,
    kind: 'query',
    quads,
  });
  knownGraphNames.add(graphName);
  visibleGraphs.add(graphName);
  saveVisibleGraphs(visibleGraphs, knownGraphNames);
  await applyGraphVisibility();
  dock.revealView('graph');
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

/**
 * Opens the pane on a query about one node, from the `q` key or the node menu.
 *
 * Selects the node first: `q` acts on the selection, but a right-click does not
 * select in cytoscape, so the menu path would otherwise bind `?this` to whatever
 * was selected before — or to nothing. Selecting here makes the two paths identical.
 */
function queryNode(iri) {
  graphPane.selectNode(iri);
  const entry = QUERY_LIBRARY.find((q) => q.needsSelection) ?? null;
  dock.revealView('query');
  if (entry) {
    queryPane.setText(entry.sparql, { silent: true });
    querySelect.value = entry.fileName;
  }
  renderQueryStatus(
    queryStatusHost,
    `${curieForGraphName(iri)} is bound to ?this — Ctrl+Enter to run.`,
  );
}

// ---------------------------------------------------------------------------
// Window layout (docs/adr/0022-column-tab-groups.md)
// ---------------------------------------------------------------------------

/**
 * Every view the layout can place, declared once.
 *
 * `defaultColumn` is where a first-time user finds it — the TriG pane starts in
 * the right column, beside the graph, because it is a secondary view and the
 * graph should have the width until asked otherwise. `homeColumn` is where
 * Alt+, sends it back to, which is the whole point of the middle column.
 *
 * The shortcut lives here rather than in a table of its own, so a view's key is
 * stated in exactly one place and the tab that advertises it cannot disagree.
 */
const VIEWS = [
  {
    id: 'editor',
    title: 'Mermaid + D3FEND source',
    shortcut: 'KeyE',
    element: document.getElementById('editor-pane'),
    defaultColumn: 0,
    onShow: () => editorPane.requestMeasure(),
    onMove: ({ hadFocus }) => {
      editorPane.requestMeasure();
      if (hadFocus) editorPane.focus();
    },
  },
  {
    id: 'files',
    title: 'Files',
    shortcut: 'KeyF',
    element: document.getElementById('files-pane'),
    defaultColumn: 0,
    hint: 'Documents stored in this browser — the one you are editing is saved as you type (Alt+F)',
    // Relative timestamps go stale while the pane is hidden.
    onShow: () => renderFiles(),
  },
  {
    id: 'preview',
    title: 'Mermaid preview',
    shortcut: 'KeyM',
    element: document.getElementById('preview-pane'),
    defaultColumn: 2,
  },
  {
    id: 'graph',
    title: 'D3FEND Graph',
    shortcut: 'KeyG',
    element: document.getElementById('graph-pane'),
    defaultColumn: 2,
    defaultActive: true,
    // Cytoscape measured a `display: none` container as zero, and its
    // ResizeObserver only re-measures — framing the drawing is a "you are seeing
    // this for the first time" action, not something a gutter drag should do.
    onShow: () => graphPane.fitView(),
    onMove: () => {
      // One `<dialog>` serves the node and the edge panel. Re-parenting the
      // ancestor of an open top-layer modal is not well defined, so close it.
      closeNodePanel(nodePanelHost);
      graphPane.fitView();
    },
  },
  {
    id: 'trig',
    title: 'TriG (RDF)',
    element: document.getElementById('turtle-pane'),
    defaultColumn: 2,
    homeColumn: 1,
    // Not a `shortcut`: Alt+, is a layout key that answers from any tab, so it is
    // handled on its own rather than through the reveal-this-tab table.
    keyHint: 'Alt+,',
    hint: 'TriG (RDF) — Alt+, moves it between its own column and this tab bar',
    onShow: () => turtlePane.requestMeasure(),
    onMove: ({ hadFocus }) => {
      turtlePane.requestMeasure();
      if (hadFocus) turtlePane.focus();
    },
  },
  {
    id: 'query',
    title: 'SPARQL',
    shortcut: 'KeyQ',
    element: document.getElementById('query-pane'),
    defaultColumn: 2,
    hint: 'SPARQL over the document and the loaded knowledge bases (Alt+Q)',
    onShow: () => queryPane.requestMeasure(),
    onMove: ({ hadFocus }) => {
      queryPane.requestMeasure();
      if (hadFocus) queryPane.focus();
    },
  },
];

const dock = createColumnLayout({
  grid: document.getElementById('app-grid'),
  columnEls: ['col-left', 'col-mid', 'col-right'].map((id) => document.getElementById(id)),
  gutterEls: ['gutter-main-col', 'gutter-mid-col'].map((id) => document.getElementById(id)),
  views: VIEWS,
});

renderFiles();

document.getElementById('turtle-hide-button').addEventListener('click', () => dock.cycleView('trig'));
document.getElementById('reset-layout-button').addEventListener('click', () => dock.reset());

// Keyed on `code`, not `key`: with Alt held some layouts report a composed
// character ('µ' for Alt+M) instead of the letter. Derived from the registry so
// a view's key is declared once (see VIEWS above).
const TAB_SHORTCUTS = Object.fromEntries(
  VIEWS.filter((view) => view.shortcut).map((view) => [view.shortcut, view.id]),
);
// Chip popovers reachable from the keyboard. A chip belongs to one pane's header,
// so it only answers while that pane is showing — a hidden pane has no measurable
// position for the popover to anchor to. `isActive` is per chip rather than one
// shared graph-tab check, now that Sources lives in the SPARQL header. Every entry
// is printed on its chip (the `shortcut` above), so the two tables have to agree.
const CHIP_SHORTCUTS = {
  KeyT: { chip: () => graphsChip, isActive: () => dock.isVisible('graph') },
  KeyN: { chip: () => nodesChip, isActive: () => dock.isVisible('graph') },
  KeyL: { chip: () => linksChip, isActive: () => dock.isVisible('graph') },
  KeyV: { chip: () => prefsChip, isActive: () => dock.isVisible('graph') },
  KeyK: { chip: () => sourcesChip, isActive: () => dock.isVisible('query') },
};

/**
 * Whether a keystroke was meant for something the user is typing into, rather
 * than for the app. Only the unmodified shortcuts need to ask: an Alt-chord
 * cannot be mistaken for typing.
 *
 * CodeMirror presents its editable surface as `contenteditable`, which covers
 * both the mermaid and the TriG editors. `select` is here for the layout
 * dropdown, which jumps to a matching option when a letter reaches it.
 */
function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return ['input', 'textarea', 'select'].includes(target.tagName?.toLowerCase());
}

/**
 * Whether an unmodified letter is meant as a graph shortcut right now. Three
 * conditions, none of which implies another:
 *
 * - the graph is on screen, so they are inert while its column is showing some
 *   other tab;
 * - focus is not in a text field. This — not the visibility check — is what does
 *   most of the work, because any column can hold any view: the mermaid editor
 *   and the graph are visible at the same time by default, and so, now, can the
 *   SPARQL pane be. Since `q` means something to both the graph and the query
 *   editor, "is the user typing?" is what keeps them apart;
 * - the info modal is closed, or the keystroke would act on an element hidden behind
 *   it. One `<dialog>` serves both the node and the edge panel, so this one check
 *   covers both.
 *
 * Visibility rather than focus is a deliberate simplification: tracking which
 * column owns the keyboard would be more precise, and is the fix if a bare key
 * ever fires for the wrong pane (docs/adr/0022-column-tab-groups.md).
 */
function isGraphShortcutContext(event) {
  return dock.isVisible('graph') && !isTypingTarget(event.target) && !nodePanelHost.open;
}

/**
 * Unmodified keys acting on the selected element. Each entry is also advertised as
 * the matching context-menu item's hint (viz/nodeMenu.js), which is where a user
 * finds out these exist — so the two have to agree.
 *
 * Each key asks the selection what kind it is and does nothing when the answer is
 * the wrong one: `f` folds a container, `s` swaps a link's direction, and only `g`
 * means something on both. A key that declines still counts as handled — it belongs
 * to the graph, so it must not fall through to whatever else is on screen.
 */
const GRAPH_SHORTCUTS = {
  f: () => {
    if (selection?.kind === 'node' && selection.foldable) {
      toggleFold(UNION_FILTER_KEY, filterState, selection.id, onFilterChange);
    }
  },
  g: () => {
    if (!selection) return;
    if (selection.kind === 'edge') goToEdgeMermaidSource(selection.data);
    else if (canGoToMermaidSource(selection.id)) goToMermaidSource(selection.id);
  },
  // What a left click on an edge used to do, on a key instead: the click was the
  // cheapest gesture there is and it silently rewrote the drawing
  // (docs/adr/0019-select-and-swap-edges.md). The toast is the whole answer for a
  // predicate with no inverse — nothing is redrawn, so nothing else would say why.
  s: () => {
    if (selection?.kind !== 'edge') return;
    if (selection.invertible) swapPredicateDirection(selection.predicate);
    // A collapsed path has no written predicate to name, so the usual toast would
    // print its synthetic key. What it does have is two legs, each with its own
    // direction, which is why there is nothing here to swap.
    else if (selection.data?.collapsed) {
      graphPane.flashError('a collapsed artifact path has no single predicate to swap');
    } else graphPane.flashError(`${selection.predicate} has no inverse property`);
  },
  // Leaves the graph tab, which no other shortcut here does — but it is the
  // selection that makes the query meaningful, so it belongs to the selection's
  // keys rather than to the SPARQL pane's.
  q: () => {
    if (selection?.kind !== 'node') return;
    queryNode(selection.id);
  },
  '>': () => {
    if (selection?.kind !== 'node') return;
    setPathFocus('outgoing');
  },
  '<': () => {
    if (selection?.kind !== 'node') return;
    setPathFocus('incoming');
  },
};

window.addEventListener(
  'keydown',
  (event) => {
    // Matched on `key`, not `code` as the Alt shortcuts are: these are mnemonics —
    // `f` for fold, `g` for "go to source" — so they should follow the character
    // typed rather than a physical key position. preventDefault stays inside the
    // guard: a letter this shortcut declines has to reach whatever did have focus.
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'Escape') {
        if (!isGraphShortcutContext(event)) return;
        if (clearPathFocus()) event.preventDefault();
        return;
      }
      const shortcut = GRAPH_SHORTCUTS[event.key?.toLowerCase()];
      if (shortcut) {
        if (!isGraphShortcutContext(event)) return;
        event.preventDefault();
        shortcut();
        return;
      }
    }
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    // Alt+Shift+arrows push the view the user last picked into the next column.
    // Shift-first, because Alt+Arrow alone is a word-wise caret move in the
    // editors and these have to work while one of them has focus.
    if (event.shiftKey) {
      const delta = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      dock.moveActiveViewBy(delta);
      return;
    }
    // A layout shortcut, so unlike the chips it answers from any tab.
    if (event.code === 'Comma') {
      event.preventDefault();
      dock.cycleView('trig');
      return;
    }
    const chip = CHIP_SHORTCUTS[event.code];
    if (chip) {
      if (!chip.isActive()) return;
      event.preventDefault();
      chip.chip().open();
      return;
    }
    const viewId = TAB_SHORTCUTS[event.code];
    if (!viewId) return;
    event.preventDefault();
    dock.revealView(viewId);
    dock.focusTab(viewId);
  },
  true,
);

// The two column gutters belong to the layout and are wired by
// layout/columns.js, which owns the widths. This one is inside a single pane —
// the query editor sits above its results — so it stays here and keeps reading
// its sizes from the DOM: there is no layout state to keep in step.
makeResizableGutter(document.getElementById('gutter-query-row'), {
  container: document.getElementById('query-grid'),
  axis: 'row',
  beforeIndex: 0,
  afterIndex: 2,
  min: 80,
});
