/**
 * The graph view as one mountable unit: the Cytoscape pane, the Graphs / Nodes /
 * Links / View chips, the selection box, the info panels and the keys that act on
 * the selection. Everything host-specific arrives through `shell`, so the SPA and
 * the VS Code webview mount the same code (docs/adr/0043-vscode-extension.md).
 *
 * The view owns what is drawn — the store, the filters, the visibility, the
 * preferences and the selection — and nothing about where the document comes from:
 * it is handed contributions with `setDocument` and tells the shell what the user
 * asked for through callbacks.
 *
 * shell = {
 *   isActive()                       the pane is on screen (gates bare keys and Alt+T/N/L/V)
 *   prompt(message, value)           → Promise<string|null>
 *   knownGraphNames()                → Set; which graphs the hidden-graph list is pruned to
 *   source: { has(mermaidId), reveal(mermaidId), hasEdge(keys), revealEdge(keys),
 *             addRelation(mermaidId, rel), changeClass(mermaidId, oldQname, newQname) }
 *                                    the last two return a boolean or a Promise of one
 *   onAddGraph(contribution)         → Promise<string|void>; a note appended to the mint message
 *   onRemoveGraph(name)              → Promise<void>
 *   onApplied()                      contributions or visibility changed (Sources popover)
 *   onQueryNode(iri)                 `q` / the node menu, after the node is selected
 *   onQueryClassPair({source,target} | null)   the edge panel's alternatives query
 *   onSelectionChange(selection)
 *   onPrefsChange(prefs)
 * }
 */

import { mermaidIdOf, writtenTriplesOf } from '../goToSource.js';
import { alternativesBetween } from '../editor/d3fendRestrictions.js';
import { curieForGraphName, PREFIXES } from '../rdf/emit.js';
import { GraphStore } from '../rdf/store.js';
import { buildGraphModel, modelPredicates } from '../rdf/graphModel.js';
import { mergeQuads, neighbourGraphName, neighbourQuads, sanitizeGraphId } from '../rdf/neighbourGraph.js';
import { createGraphPane } from './graphPane.js';
import {
  loadFilterState,
  renderFilterPanel,
  renderNodeFilterPanel,
  invertPredicateDirection,
  toggleFold,
  toggleMatchingLinkKinds,
} from './filterPanel.js';
import {
  loadVisibleGraphs,
  saveVisibleGraphs,
  renderGraphPanel,
  graphMatchesQuery,
} from './graphVisibility.js';
import { createFilterChip } from './filterChip.js';
import { loadPrefs, savePrefs } from './graphPrefs.js';
import { renderPrefsPanel } from './prefsPanel.js';
import { LAYOUTS, DEFAULT_LAYOUT_ID } from './layouts.js';
import { applyPanelFontSize, closeNodePanel, renderNodePanel } from './nodePanel.js';
import { renderEdgePanel } from './edgePanel.js';
import { renderSelectionBox } from './selectionBox.js';

const UNION_FILTER_KEY = '__union__';

const MARKUP = `
  <div class="pane-header">
    <h2>D3FEND Graph</h2>
    <div id="graph-filter-chips" class="filter-chips"></div>
    <div id="graph-selection" class="graph-selection is-empty">no selection</div>
    <div class="graph-tools">
      <select id="layout-select" title="Layout algorithm"></select>
      <button type="button" id="rotate-ccw" class="icon-button" title="Rotate 90° counter-clockwise (Shift+R)">⟲</button>
      <button type="button" id="rotate-cw" class="icon-button" title="Rotate 90° clockwise (R)">⟳</button>
    </div>
  </div>
  <div id="cy-host"></div>
  <dialog id="node-panel" class="node-panel"></dialog>
`;

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

export function mountGraphView(host, shell) {
  host.innerHTML = MARKUP;
  const $ = (selector) => host.querySelector(selector);
  const filterChipHost = $('#graph-filter-chips');
  const cyHost = $('#cy-host');
  const nodePanelHost = $('#node-panel');
  const selectionBoxHost = $('#graph-selection');

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
  // The info panel is a <dialog> the graph pane does not style, so setPrefs cannot
  // reach it: its text size is applied to it directly, here and on every change.
  applyPanelFontSize(nodePanelHost, prefs.panelFontSize);
  const prefsChip = createFilterChip(filterChipHost, {
    id: 'prefs',
    label: 'View',
    icon: '⚙',
    title: 'Visualization preferences',
    shortcut: 'Alt+V',
  });

  // The element the keyboard acts on, as the graph pane reports it (viz/graphPane.js):
  // `{ kind: 'node' | 'edge', … }`, or null. Declared before the pane, which reports
  // into it. The kind is what the shortcut table below dispatches on — `f` means
  // nothing on an edge, `s` means nothing on a node.
  let selection = null;
  let pathFocus = null;

  function setPathFocus(direction, nodeId = selection?.id, maxDepth = Infinity) {
    if (!nodeId) return;
    const active = graphPane.setPathFocus(nodeId, direction, maxDepth);
    pathFocus = active ? { nodeId, direction, maxDepth } : null;
  }

  /**
   * Extends a bounded flow focus by one hop, or starts one at a single hop.
   *
   * The whole walk at once is what `>` / `<` do, and on a graph whose components
   * have both inbound and outbound relations that is nearly the entire diagram
   * (docs/adr/00032-improve-flow-discovery.md). Stepping is the other reading of
   * the same walk: one hop per press, so the order of the hops is shown rather
   * than reassembled by eye.
   *
   * Restarts from one hop whenever the selection or the direction changed, since
   * the bound belongs to a walk and not to the pane. The toast is the whole answer
   * at the end of the flow — nothing is redrawn, so nothing else would say why,
   * which is the reason `s` has one too.
   */
  function stepPathFocus(direction, nodeId = selection?.id) {
    if (!nodeId) return;
    const reach = graphPane.pathFocusReach();
    // An unbounded focus on the same node — `>` pressed first — is not a step to
    // extend but a walk to start over from one hop, which is the only way stepping
    // in after `>` shows anything the reader did not already have.
    const stepped =
      reach?.nodeId === nodeId && reach.direction === direction && Number.isFinite(reach.maxDepth);
    if (stepped && !reach.truncated) {
      graphPane.flashError(`no ${direction} link beyond ${reach.maxDepth} hop(s) from here`);
      return;
    }
    setPathFocus(direction, nodeId, stepped ? reach.maxDepth + 1 : 1);
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
   * Function declarations, so they can be named in the pane's options below — they
   * only run once something is clicked.
   */

  /** Whether `iri` came from the diagram and the editor can still find it. */
  function canGoToMermaidSource(iri) {
    const id = mermaidIdOf(iri);
    return Boolean(id) && shell.source.has(id);
  }

  function goToMermaidSource(iri) {
    const id = mermaidIdOf(iri);
    if (id) shell.source.reveal(id);
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
    return shell.source.hasEdge(writtenTriplesOf(data, filterState));
  }

  function goToEdgeMermaidSource(data) {
    const keys = writtenTriplesOf(data, filterState);
    if (shell.source.hasEdge(keys)) shell.source.revealEdge(keys);
  }

  /**
   * The graph id the last mint used, so the prompt offers it again.
   *
   * Adding a second node to the neighbourhood you just built is the common case and
   * defaulting to the node's own id would make the user retype the shared name
   * every time. Session-scoped on purpose: it is a convenience, not a setting.
   */
  let lastNeighbourGraphId = null;

  /**
   * Mints a node's D3FEND neighbourhood into a named graph the user names, and
   * reports where it went — or null if nothing was added.
   *
   * Several nodes can share one graph, which is why the id is prompted for and why
   * the quads are *merged*: the instances are keyed by graph and class
   * (rdf/neighbourGraph.js), so a class two nodes both neighbour is one resource
   * with two links, and re-minting the same node adds nothing.
   *
   * The graph is deliberately not sweepable: the shell keeps it out of the set a
   * text change drops, which would delete it on the next keystroke in the mermaid
   * pane. The enrichment graph is the precedent for a contribution that outlives an
   * edit; the Graphs panel's "✕" is how this one goes away.
   */
  async function mintNeighbourGraph(nodeData, localName) {
    const suggested = lastNeighbourGraphId ?? sanitizeGraphId(mermaidIdOf(nodeData.id) || localName);
    const answer = await shell.prompt(`Add the neighbours of ${localName} to which graph?`, suggested);
    if (answer === null) return null;

    const graphId = sanitizeGraphId(answer);
    lastNeighbourGraphId = graphId;
    const graphName = neighbourGraphName(graphId);
    const existing = graphContributions.get(graphName);
    const { quads, added } = mergeQuads(existing?.quads, neighbourQuads(nodeData.id, localName, graphId));
    if (!quads.length) return null;

    const label = curieForGraphName(graphName);
    const contribution = {
      name: graphName,
      label,
      description: `D3FEND neighbourhood (${quads.length} triples)`,
      // Not a kind of its own: the Graphs panel groups everything that is not
      // enrichment with the diagrams, and 'query' already means "added by the user,
      // removable" there.
      kind: 'query',
      quads,
    };
    graphContributions.set(graphName, contribution);
    visibleGraphs.add(graphName);
    const note = await shell.onAddGraph(contribution);
    applyVisibility();

    const where = `${label}${note ?? ''}`;
    return added ? `${added} new in ${where}` : `already in ${where}`;
  }

  /**
   * What the info panel may do. `onAddRelation` is absent for a node the diagram did
   * not write — a d3f: class, an enrichment resource, an IRI typed in the TriG
   * pane — which is what keeps the "+" off rows there is nothing to attach to
   * (docs/adr/0018-add-defensive-measure.md).
   *
   * `onMintNeighbours` is not gated the same way: it writes RDF and never mermaid,
   * so a node with no mermaid origin is exactly where it earns its keep.
   */
  function nodePanelActions(nodeData) {
    const actions = { onMintNeighbours: (localName) => mintNeighbourGraph(nodeData, localName) };
    const id = mermaidIdOf(nodeData.id);
    if (!id || !shell.source.has(id)) return actions;
    return {
      ...actions,
      onAddRelation: (rel) => shell.source.addRelation(id, rel),
      // Closes rather than refreshes: the class just changed, so every
      // relation/metadata row the panel is showing is for the class the node
      // no longer has, and the redraw the change triggers lands after the
      // usual debounce (docs/adr/0019-select-and-swap-edges.md).
      onChangeClass: async (oldQname, newQname) => {
        const changed = await shell.source.changeClass(id, oldQname, newQname);
        if (changed) closeNodePanel(nodePanelHost);
        return changed;
      },
    };
  }

  /**
   * What the edge panel may do. Empty for an edge with no mermaid origin — an
   * enrichment triple, or one typed into the TriG pane — which is what keeps the
   * button off a panel that could not honour it.
   *
   * The panel closes on the way out: the jump hands the user over to the editor, and
   * the button says it will.
   */
  function edgePanelActions(edgeData) {
    const actions = { onQueryAlternatives: () => queryEdgeAlternatives(edgeData) };
    // The mermaid jump is the one that has to be earned: a derived or collapsed
    // edge has no single line to jump to. The query is about the two classes, not
    // about how the link was written, so it is offered either way.
    if (!canGoToEdgeMermaidSource(edgeData)) return actions;
    actions.onGoToSource = () => {
      closeNodePanel(nodePanelHost);
      goToEdgeMermaidSource(edgeData);
    };
    return actions;
  }

  /**
   * A drawn node's first `d3f:` class, as a bare local name.
   *
   * The bare name is what data/d3fend-metadata.json is keyed by, and the first
   * class is what `rdfType` already picks for the drawing — a node with both a
   * D3FEND and a DPV type (ADR 0028) is looked up under its D3FEND one, and one
   * with no D3FEND type at all is not a question this can answer.
   */
  function d3fClassOfNode(iri) {
    const types = currentModel.nodes.get(iri)?.types ?? [];
    const d3f = types.find((type) => type.startsWith(PREFIXES.d3f));
    return d3f ? d3f.slice(PREFIXES.d3f.length) : null;
  }

  /**
   * The other predicates that could connect a drawn edge's two ends.
   *
   * Computed here rather than in the panel because `edgePanelSummary` is a pure
   * function of the cytoscape data and the view is not allowed to reach into the
   * RDF layer (ADR 0014) — the classes come from the model, which only this view
   * holds. Empty for a collapsed artifact path, whose arrow names no predicate and
   * stands for two triples with two different ones
   * (docs/adr/0026-collapse-artifact-mediated-paths.md).
   */
  function edgeAlternatives(edgeData) {
    if (edgeData?.collapsed) return [];
    const source = d3fClassOfNode(edgeData?.source);
    const target = d3fClassOfNode(edgeData?.target);
    if (!source || !target) return [];
    return alternativesBetween(source, target);
  }

  /** The two classes an edge connects, from its info panel; null if either end has no `d3f:` class. */
  function queryEdgeAlternatives(edgeData) {
    const source = d3fClassOfNode(edgeData?.source);
    const target = d3fClassOfNode(edgeData?.target);
    closeNodePanel(nodePanelHost);
    shell.onQueryClassPair(source && target ? { source, target } : null);
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
    // A double click or a menu action, never a left click: that one selects instead
    // (docs/adr/0008-show-node.md). The panel stays on what it was opened on — a
    // click elsewhere moves the selection, not the card
    // (docs/adr/0037-non-modal-info-card.md).
    onShowInfo: (nodeData) =>
      renderNodePanel(nodePanelHost, nodeData, store, nodePanelActions(nodeData)),
    // Edges answer the same gesture as nodes, now that a tap on one only selects
    // (docs/adr/0019-select-and-swap-edges.md). Same host, so only one panel can be
    // open and `isGraphShortcutContext` keeps guarding on the one `.open`.
    onShowEdgeInfo: (edgeData) =>
      renderEdgePanel(nodePanelHost, edgeData, edgePanelActions(edgeData), {
        alternatives: edgeAlternatives(edgeData),
      }),
    onSelectionChange: (next) => {
      selection = next;
      renderSelectionBox(selectionBoxHost, next);
      shell.onSelectionChange?.(next);
    },
    onShowOutgoingFlow: (nodeId) => setPathFocus('outgoing', nodeId),
    onShowIncomingFlow: (nodeId) => setPathFocus('incoming', nodeId),
    onStepOutgoingFlow: (nodeId) => stepPathFocus('outgoing', nodeId),
    onStepIncomingFlow: (nodeId) => stepPathFocus('incoming', nodeId),
    onSwapDirection: swapPredicateDirection,
    onQuery: (iri) => queryNode(iri),
    // Folding is view state, so it goes through the same filter path as everything
    // else in this header: the store is untouched and the TriG never moves.
    onFoldToggle: (iri) => foldNode(iri),

    // Named rather than inline, because the `g` shortcut asks the same two questions
    // of the selected element and must not answer them differently.
    canGoToSource: canGoToMermaidSource,
    onGoToSource: goToMermaidSource,
    canGoToEdgeSource: canGoToEdgeMermaidSource,
    onGoToEdgeSource: goToEdgeMermaidSource,
  });

  /**
   * Opens the SPARQL pane on a query about one node, from the `q` key or the node
   * menu.
   *
   * Selects the node first: `q` acts on the selection, but a right-click does not
   * select in cytoscape, so the menu path would otherwise bind `?this` to whatever
   * was selected before — or to nothing. Selecting here makes the two paths identical.
   */
  function queryNode(iri) {
    graphPane.selectNode(iri);
    shell.onQueryNode(iri);
  }

  // The view model, rebuilt from the store's quads whenever they change. Filter
  // changes re-render from this same model without touching the store.
  let currentModel = { nodes: new Map(), edges: [], containment: new Map(), parentOf: new Map() };
  // Loaded rather than hand-built, so the very first render already has the
  // complete shape, including visibleKinds and visibleNodeKinds.
  let filterState = loadFilterState(UNION_FILTER_KEY, []);
  // The node the next render should keep still, set by a fold and consumed by the
  // very next renderGraph() (see graphPane.update's anchorNode). A one-shot rather
  // than lasting state: only the render a fold causes should skip the refit.
  let pendingViewAnchor = null;
  // The contributions as the shell last handed them over, by name.
  let graphContributions = new Map();
  let visibleGraphs = new Set();
  let allPredicates = [];

  /**
   * Folds or unfolds a node, keeping the view on it.
   *
   * Named rather than inline because the context menu and the `f` shortcut both
   * fold, and a fold that refits from one of them and not the other would read as a
   * bug in the shortcut. `toggleFold` renders synchronously, so the anchor set here
   * is always the one that render reads.
   */
  function foldNode(iri) {
    pendingViewAnchor = iri;
    toggleFold(UNION_FILTER_KEY, filterState, iri, onFilterChange);
  }

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
    // Read and cleared before the render, so a render that throws cannot leave the
    // anchor behind for whatever renders next.
    const anchorNode = pendingViewAnchor;
    pendingViewAnchor = null;
    const stats = graphPane.update(currentModel, filterState, { anchorNode });
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
    const rebuild =
      next.collapseArtifactPaths !== prefs.collapseArtifactPaths ||
      next.orientByFlow !== prefs.orientByFlow ||
      // Absorbing a location link removes it and sometimes the place it pointed at,
      // and the box view reparents on top of that, so a restyle would leave the old
      // drawing on screen (docs/adr/0036-location-pins.md).
      next.locationView !== prefs.locationView;
    prefs = next;
    savePrefs(next);
    graphPane.setPrefs(next);
    applyPanelFontSize(nodePanelHost, next.panelFontSize);
    // The editors' text size is a preference of this panel but not this view's to
    // apply: CodeMirror caches character metrics, so the shell re-measures them.
    shell.onPrefsChange?.(next);
    if (rebuild) renderGraph();
  }, { bulkHost: prefsChip.bulkHost });

  /**
   * Syncs the store with the currently-visible graphs and rebuilds the view model
   * from it. The store is the only input to the model, so hiding a graph removes
   * its nodes and edges without any bookkeeping on the diagram side.
   */
  function syncModel() {
    const edgeComments = [];
    for (const contribution of graphContributions.values()) {
      const isVisible = visibleGraphs.has(contribution.name);
      store.replaceGraph(contribution.name, isVisible ? contribution.quads : []);
      if (isVisible && contribution.edgeComments) edgeComments.push(...contribution.edgeComments);
    }
    currentModel = buildGraphModel(store, { edgeComments });
  }

  /** A change of visibility or of a user-added graph; the filters keep their state. */
  function applyVisibility() {
    syncModel();
    renderGraphsPanel();
    shell.onApplied?.();
    renderGraph();
  }

  /**
   * Replaces the document. A graph that was drawn and is no longer listed leaves the
   * store too, since the loop in `syncModel` only walks what still exists.
   *
   * `keepFilters` is for a change that came from the TriG pane: it does not recompute
   * the link kinds on offer, which the next change of the mermaid text does.
   * Returns the warnings about the merged store, which only the model can see
   * (docs/adr/0036-location-pins.md).
   */
  function setDocument(contributions, { keepFilters = false } = {}) {
    const next = new Map(contributions.map((c) => [c.name, c]));
    for (const name of graphContributions.keys()) {
      if (!next.has(name)) store.replaceGraph(name, []);
    }
    graphContributions = next;
    // Recomputed, never saved: saveVisibleGraphs() prunes hidden names that are
    // absent from the document, and a graph the user is mid-way through retyping
    // would lose its hidden flag and pop back into view.
    visibleGraphs = loadVisibleGraphs([...graphContributions.keys()]);
    syncModel();
    if (!keepFilters) {
      allPredicates = modelPredicates(currentModel);
      filterState = loadFilterState(UNION_FILTER_KEY, allPredicates);
      renderLinksPanel();
      renderNodeFilterPanel(nodesChip.body, UNION_FILTER_KEY, filterState, onFilterChange, {
        bulkHost: nodesChip.bulkHost,
      });
    }
    renderGraphsPanel();
    shell.onApplied?.();
    renderGraph();
    return { warnings: currentModel.warnings ?? [] };
  }

  /**
   * Draws a graph the shell has already added to the document — a CONSTRUCT result.
   * `save` also records its visibility, which is what the Graphs panel's own
   * toggles do and a minted graph does not.
   */
  async function addContribution(contribution, { save = false } = {}) {
    graphContributions.set(contribution.name, contribution);
    visibleGraphs.add(contribution.name);
    if (save) saveVisibleGraphs(visibleGraphs, shell.knownGraphNames());
    applyVisibility();
  }

  /**
   * Re-renders the Graphs popover alone. Typing in its search box changes nothing
   * in the store, so filtering must not go through applyVisibility().
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
        applyVisibility();
      },
      {
        bulkHost: graphsChip.bulkHost,
        onSetAll: (checked) => {
          visibleGraphs = new Set(checked ? graphContributions.keys() : []);
          saveVisibleGraphs(visibleGraphs, graphContributions.keys());
          applyVisibility();
        },
        query: graphQuery,
        onDelete: removeGraph,
      },
    );
    graphsChip.setCount(visibleGraphs.size, graphContributions.size);
  }

  /**
   * Drops a user-added graph from the document for good — the counterpart of
   * `mintNeighbourGraph` and of a CONSTRUCT result added as a graph.
   *
   * `store.replaceGraph` has to be called here rather than left to `syncModel`:
   * that loop walks the contributions that still exist, so a graph removed from the
   * map would keep its quads in the store forever.
   */
  async function removeGraph(graphName) {
    if (!graphContributions.delete(graphName)) return;
    visibleGraphs.delete(graphName);
    store.replaceGraph(graphName, []);
    await shell.onRemoveGraph(graphName);
    saveVisibleGraphs(visibleGraphs, shell.knownGraphNames());
    applyVisibility();
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
    applyVisibility();
  }

  const layoutSelect = $('#layout-select');
  for (const layout of LAYOUTS) {
    const option = document.createElement('option');
    option.value = layout.id;
    option.textContent = layout.hierarchical ? layout.label : `${layout.label} (flat)`;
    if (layout.id === DEFAULT_LAYOUT_ID) option.selected = true;
    layoutSelect.appendChild(option);
  }
  layoutSelect.addEventListener('change', () => graphPane.setLayout(layoutSelect.value));

  $('#rotate-cw').addEventListener('click', () => graphPane.rotate(1));
  $('#rotate-ccw').addEventListener('click', () => graphPane.rotate(-1));

  // Chip popovers reachable from the keyboard. A chip belongs to one pane's header,
  // so it only answers while that pane is showing — a hidden pane has no measurable
  // position for the popover to anchor to. Every entry is printed on its chip (the
  // `shortcut` above), so the two tables have to agree.
  const CHIP_SHORTCUTS = {
    KeyT: graphsChip,
    KeyN: nodesChip,
    KeyL: linksChip,
    KeyV: prefsChip,
  };

  /**
   * Bare-key shortcuts gate on visibility, not on focus: "is the graph on screen, is
   * the user not typing, is focus outside the info panel". (The last is not "is the
   * info modal closed" any more: the panel no longer hides what a key would act on —
   * docs/adr/0037-non-modal-info-card.md.)
   */
  function isGraphShortcutContext(event) {
    return (
      shell.isActive() &&
      !isTypingTarget(event.target) &&
      !nodePanelHost.contains(event.target)
    );
  }

  // The unmodified keys, keyed by character. Their hints are written a second time
  // in viz/nodeMenu.js and nothing enforces that the two agree, so a new key means
  // editing both.
  const GRAPH_SHORTCUTS = {
    f: () => {
      if (selection?.kind === 'node' && selection.foldable) foldNode(selection.id);
    },
    g: () => {
      if (!selection) return;
      if (selection.kind === 'edge') goToEdgeMermaidSource(selection.data);
      else if (canGoToMermaidSource(selection.id)) goToMermaidSource(selection.id);
    },
    s: () => {
      if (selection?.kind !== 'edge') return;
      if (selection.invertible) swapPredicateDirection(selection.predicate);
      else if (selection.data?.collapsed) {
        graphPane.flashError('a collapsed artifact path has no single predicate to swap');
      } else graphPane.flashError(`${selection.predicate} has no inverse property`);
    },
    b: () => {
      if (selection?.kind !== 'node') return;
      if (!graphPane.setFlowRoot(selection.id)) {
        graphPane.flashError('this layout cannot start the reading from a node — try ELK layered or breadth-first');
      }
    },
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
    '.': () => {
      if (selection?.kind !== 'node') return;
      stepPathFocus('outgoing');
    },
    ',': () => {
      if (selection?.kind !== 'node') return;
      stepPathFocus('incoming');
    },
    '/': () => graphPane.openSearch(),
    r: (event) => {
      if (!event.repeat) graphPane.rotate(event.shiftKey ? -1 : 1);
    },
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === 'Escape') {
          // The info panel closes first, wherever the keyboard is outside a text
          // field; a path focus is only cleared while the graph is the pane in use.
          if (nodePanelHost.open && !isTypingTarget(event.target)) {
            closeNodePanel(nodePanelHost);
            event.preventDefault();
            return;
          }
          if (!isGraphShortcutContext(event)) return;
          if (clearPathFocus()) event.preventDefault();
          return;
        }
        const shortcut = GRAPH_SHORTCUTS[event.key?.toLowerCase()];
        if (shortcut) {
          if (!isGraphShortcutContext(event)) return;
          event.preventDefault();
          shortcut(event);
        }
        return;
      }
      // Keyed on `code`, not `key`: with Alt held some layouts report a composed
      // character ('µ' for Alt+M) instead of the letter.
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const chip = CHIP_SHORTCUTS[event.code];
      if (!chip || !shell.isActive()) return;
      event.preventDefault();
      chip.open();
    },
    true,
  );

  return {
    setDocument,
    addContribution,
    /** The selected node or edge, as the pane reports it, or null. */
    selection: () => selection,
    /** What is drawn now, for the query pane's "show in graph" buttons. */
    drawnNodeIds: () => new Set(currentModel.nodes.keys()),
    selectNode: (iri) => graphPane.selectNode(iri),
    flashError: (message) => graphPane.flashError(message),
    fitView: () => graphPane.fitView(),
    resize: () => graphPane.resize(),
    closePanel: () => closeNodePanel(nodePanelHost),
    prefs: () => prefs,
  };
}
