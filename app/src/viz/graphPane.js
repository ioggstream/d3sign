import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import { toCytoscapeElements } from './toCytoscape.js';
import { DEFAULT_LAYOUT_ID, layoutOptions, normalizeSteps, rotatePoint } from './layouts.js';
import { buildStyle } from './graphStyle.js';
import { DEFAULT_PREFS, containerLabelBandFor, estimatedLabelLines } from './graphPrefs.js';
import { separateSiblings, siblingLevels } from './separateSiblings.js';
import { loadIconSet } from './icons.js';
import { edgeMenuItems, nodeMenuItems } from './nodeMenu.js';
import { directionalFlow } from './pathFocus.js';

cytoscape.use(elk);

/** Preferences that feed the layout, so changing them costs a re-run and not just a restyle. */
const LAYOUT_AFFECTING = ['nodeSpacing', 'nodeSize', 'fontSize', 'nodeStyle', 'containerPadding'];
const PATH_FOCUS_DIRECTIONS = new Set(['outgoing', 'incoming']);
const PATH_FOCUS_DIM_CLASS = 'path-focus-dim';
const PATH_FOCUS_NODE_CLASS = 'path-focus-node';
const PATH_FOCUS_EDGE_CLASS = 'path-focus-edge';

/**
 * Least gap the separation pass leaves between two sibling boxes.
 *
 * Small on purpose: how far apart things sit is the layout's business and the
 * spacing slider's, and this pass only has to correct the overlaps the layout
 * left behind. Enough that two borders read as two borders.
 */
const SEPARATION_GAP = 8;

/**
 * How long after a click a second one still counts as a double click. Matches the
 * usual desktop threshold rather than cytoscape's tighter default, so a double
 * click a user considers deliberate is treated as one.
 */
const DOUBLE_CLICK_MS = 500;

function flashEdgeError(host, message) {
  let toast = host.querySelector('.edge-flash-error');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'edge-flash-error';
    host.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
}

/**
 * What the shell is told about the selected element, as
 * `{ kind: 'node' | 'edge', … }`. The kind is what the keyboard dispatches on:
 * `f` only means something on a node, `s` only on an edge (main.js).
 *
 * The edge case hands back its whole `data` alongside the named fields, which is
 * exactly what the right-click menu already gets. `writtenTriplesOf` (goToSource.js)
 * and the edge panel both need the lot — `derived`, `foldedFrom`, `foldedTo` — so
 * handing over less would make the keyboard path answer differently from the menu
 * path for a folded edge.
 */
function selectionOf(element) {
  const data = element.data();
  if (element.isEdge()) {
    return {
      kind: 'edge',
      id: data.id,
      // The written CURIE and the drawn one differ whenever the predicate is
      // flipped, and both are needed: `s` acts on `predicate`, the box shows `label`.
      predicate: data.predicate,
      label: data.label,
      source: data.source,
      target: data.target,
      invertible: Boolean(data.invertible),
      data,
    };
  }
  return { kind: 'node', id: data.id, foldable: Boolean(data.foldable), folded: Boolean(data.folded) };
}

/**
 * Re-selects, after a rebuild, the edge standing for the same relation as `data`.
 *
 * Not by id, the way nodes are: an edge's id is built from its *drawn* endpoints
 * and its *drawn* label (viz/toCytoscape.js), and swapping a predicate's direction
 * rewrites all three. Matching on the id would drop the selection on the very
 * keystroke that acted on it, leaving a second `s` with nothing to swap back.
 *
 * What survives a swap is the written predicate — never the inverse label — and
 * the pair of endpoints. Only their order does not, so the pair is matched
 * unordered.
 */
function reselectEdge(cy, data) {
  // NUL as the separator, since it cannot occur in an IRI. Built rather than typed:
  // one raw NUL byte in the source makes git call the whole module binary, so it has
  // no reviewable diff, and makes grep skip the file entirely.
  const endpointKey = (from, to) => [from, to].sort().join(String.fromCharCode(0));
  const wanted = endpointKey(data.source, data.target);
  const match = cy
    .edges()
    .filter(
      (edge) =>
        edge.data('predicate') === data.predicate &&
        endpointKey(edge.data('source'), edge.data('target')) === wanted,
    );
  if (match.nonempty()) match[0].select();
}

/**
 * A popup menu over the canvas, opened by a right-click on a node.
 *
 * Plain DOM rather than a cytoscape extension, and it lives inside `host` like
 * the flash toast does: all it needs is the pointer's position within the host,
 * which `cxttap` already reports as `renderedPosition`.
 */
function createContextMenu(host) {
  const menu = document.createElement('ul');
  menu.className = 'graph-context-menu';
  menu.hidden = true;
  host.appendChild(menu);

  // Cytoscape binds its pointer handlers to the *container*, and treats any event
  // whose target sits anywhere inside it as a canvas event (its `eventInContainer`
  // walks the whole parent chain). This menu is a child of that container, so
  // without stopping the events here a click on an item is also read as a click
  // on the background: cytoscape calls preventDefault on the mousedown and emits
  // a background `tap`, whose handler below dismisses the menu — the item never
  // runs. Stopping at the menu leaves the button's own listener intact, since
  // that fires on the target before the event bubbles this far.
  for (const type of ['mousedown', 'mouseup', 'click']) {
    menu.addEventListener(type, (event) => event.stopPropagation());
  }

  function close() {
    menu.hidden = true;
    menu.replaceChildren();
  }

  /**
   * Opens with one button per `{ label, hint, onSelect }`, at `position` in the
   * host. The hint is the gesture that reaches the same action without the menu,
   * shown beside the label so the menu is where the shortcuts are learnt.
   */
  function open(position, items) {
    menu.replaceChildren();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      // What the action does, where the label only had room for what to press.
      button.title = item.description ?? item.label;

      const label = document.createElement('span');
      label.textContent = item.label;
      button.appendChild(label);
      if (item.hint) {
        const hint = document.createElement('kbd');
        hint.className = 'graph-context-menu-hint';
        hint.textContent = item.hint;
        button.appendChild(hint);
      }

      button.addEventListener('click', () => {
        close();
        item.onSelect();
      });
      const entry = document.createElement('li');
      entry.appendChild(button);
      menu.appendChild(entry);
    }

    // Shown before measuring — a hidden element has no size — then pulled back
    // inside the host if opening at the pointer would hang it off an edge.
    menu.hidden = false;
    const bounds = host.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(position.x, bounds.width - box.width))}px`;
    menu.style.top = `${Math.max(0, Math.min(position.y, bounds.height - box.height))}px`;
  }

  return { open, close };
}

export function createGraphPane(host, {
  onShowInfo,
  onShowEdgeInfo,
  onShowOutgoingFlow,
  onShowIncomingFlow,
  onSelectionChange,
  onFoldToggle,
  onGoToSource,
  canGoToSource,
  onGoToEdgeSource,
  canGoToEdgeSource,
  onSwapDirection,
  onQuery,
  prefs = DEFAULT_PREFS,
} = {}) {
  let layoutId = DEFAULT_LAYOUT_ID;
  // Quarter turns applied on top of whatever the layout algorithm produced.
  // Kept as state so a re-render (filter change, new diagram) keeps the
  // orientation the user picked instead of snapping back to the algorithm's.
  let rotationSteps = 0;
  let iconSet = null;
  let pathFocus = null;

  const cy = cytoscape({
    container: host,
    style: buildStyle(prefs, iconSet),
    layout: layoutOptions(layoutId, prefs),
    // Cytoscape's own default is 250ms, which is half what desktop environments
    // give a double click (~500ms) — a deliberate one lands outside the window and
    // arrives as two single taps, so `dbltap` never fires and the info panel never
    // opens (docs/adr/0008-show-node.md).
    multiClickDebounceTime: DOUBLE_CLICK_MS,
  });

  // Icons arrive over the network, so the first render is always colour-only.
  // Restyling is enough once they land: no element data and no size changes, so
  // the layout still holds.
  loadIconSet().then((set) => {
    if (!set) return;
    iconSet = set;
    cy.style(buildStyle(prefs, iconSet));
    // A container's icon is taller than one line of label, so the band a container
    // needs can change the moment the icons land.
    applyContainerBands();
  });

  // Dragging a child changes the children's bounding box, and the band is measured
  // from it — without this the container keeps the height it had before the drag.
  cy.on('dragfree', 'node', () => applyContainerBands());

  /**
   * Rotates the drawing by `steps` quarter turns around its bounding-box centre.
   * Only childless nodes are moved: cytoscape derives a compound parent's box
   * from its children, so moving the leaves carries the containers along.
   */
  function rotateBy(steps) {
    const turns = normalizeSteps(steps);
    if (!turns || cy.nodes().empty()) return;
    const bb = cy.elements().boundingBox();
    const center = { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
    cy.batch(() => {
      cy.nodes().filter((n) => n.isChildless()).forEach((n) => {
        n.position(rotatePoint(n.position(), center, turns));
      });
    });
  }

  /**
   * Pushes apart every pair of siblings whose boxes overlap, so that no node is
   * drawn inside a container that does not contain it. No layout guarantees this
   * (see viz/separateSiblings.js), so it runs after every one of them.
   *
   * Deliberately not wrapped in `cy.batch()`: a container's box is recomputed
   * lazily and `updateCompoundBounds` skips the work while batching, so a batch
   * here would have each level measuring the boxes from before the level below
   * moved. `shift()` batches its own subtree walk anyway.
   */
  function separateOverlaps() {
    for (const siblings of siblingLevels(cy)) {
      const boxes = siblings.map((node) => ({ id: node.id(), ...node.boundingBox() }));
      for (const [id, delta] of separateSiblings(boxes, SEPARATION_GAP)) {
        // `shift` on a container translates its whole subtree, so a child never
        // ends up outside the parent it was measured inside.
        cy.getElementById(id).shift({ x: delta.dx, y: delta.dy });
      }
    }
  }

  /**
   * Gives every container the band its own label needs, above its children.
   *
   * The band cannot live in the stylesheet. Cytoscape's compound `padding` is one
   * number for all four sides — `padding-top` and friends are aliases of it — so
   * putting the band there charges the same room to the left, the right and the
   * bottom, where nothing is drawn. The band is extra node *height* instead:
   * `min-height` with `min-height-bias-top: 100%` (set in graphStyle.js) makes
   * `updateCompoundBounds` put the whole surplus above the children.
   *
   * And `min-height` cannot be a style mapper either, because it is the children's
   * measured height plus the band, and a mapper is evaluated when the stylesheet is
   * applied and then cached — it would freeze at the geometry of that moment. So it
   * is maintained here, after anything that moves a child or changes the band.
   *
   * Innermost containers first: an outer container measures its children, and one
   * of those children may be a container whose own height is about to change. The
   * measurement matches what `updateCompoundBounds` does — labels in, overlays out,
   * cache off — so the number this writes is the one cytoscape will compare against.
   *
   * Deliberately not batched, for the reason `separateOverlaps` gives: compound
   * bounds are not recomputed while batching, so each container would measure the
   * boxes from before the level below it moved.
   */
  function applyContainerBands() {
    const containers = cy.nodes().filter((node) => node.isParent());
    if (containers.empty()) return;
    const depthOf = (node) => node.ancestors().length;
    for (const node of containers.sort((a, b) => depthOf(b) - depthOf(a)).toArray()) {
      const band = containerLabelBandFor(prefs, estimatedLabelLines(node.data('label'), prefs.fontSize));
      const children = node.children().boundingBox({
        includeLabels: true,
        includeOverlays: false,
        useCache: false,
      });
      node.style('min-height', children.h + band);
    }
  }

  /** Runs the current layout, re-applying the pending rotation once it settles. */
  function runLayout() {
    const layout = cy.layout(layoutOptions(layoutId, prefs));
    layout.one('layoutstop', () => {
      rotateBy(rotationSteps);
      // Before separating: the band is part of a container's box, so overlaps have
      // to be judged against the box that will actually be drawn.
      applyContainerBands();
      // After the rotation, which turns the node boxes but not the labels inside
      // them — a drawing with no overlaps can gain some on a quarter turn.
      separateOverlaps();
      cy.fit(undefined, 20);
    });
    layout.run();
  }

  // Keep the graph filling its tile as the panes are resized (drag gutters,
  // window resize) — cytoscape doesn't pick this up on its own since the
  // container size changes without the window itself firing 'resize'.
  //
  // Re-measure only: refitting here would throw away the pan and zoom the user
  // set every time a gutter moved. Fitting is a "you are seeing this pane for
  // the first time" action, so it belongs to `fitView` and its callers.
  const resizeObserver = new ResizeObserver(() => cy.resize());
  resizeObserver.observe(host);

  // Every per-element action lives on the context menu: no hit box to compute, and
  // nothing drawn on the element that a small node or a wide label could displace
  // (docs/adr/0012-fold-container-nodes.md). It is also where the keyboard
  // shortcuts are taught, so an action reachable by key must appear here too
  // (viz/nodeMenu.js).
  const contextMenu = createContextMenu(host);
  function clearPathFocusClasses() {
    cy.batch(() => {
      cy.nodes().removeClass(`${PATH_FOCUS_DIM_CLASS} ${PATH_FOCUS_NODE_CLASS}`);
      cy.edges().removeClass(`${PATH_FOCUS_DIM_CLASS} ${PATH_FOCUS_EDGE_CLASS}`);
    });
  }

  function applyPathFocus() {
    if (!pathFocus) {
      clearPathFocusClasses();
      return;
    }

    const { nodeId, direction } = pathFocus;
    if (!PATH_FOCUS_DIRECTIONS.has(direction)) {
      pathFocus = null;
      clearPathFocusClasses();
      return;
    }

    if (cy.getElementById(nodeId).empty()) {
      pathFocus = null;
      clearPathFocusClasses();
      return;
    }

    const edges = cy.edges().map((edge) => ({
      id: edge.id(),
      source: edge.data('source'),
      target: edge.data('target'),
      // A two-way link is one element standing for the relation asserted each
      // way, so the flow can be followed along it in either direction.
      bidirectional: edge.data('bidirectional'),
    }));
    const focused = directionalFlow(cy.nodes().map((node) => node.id()), edges, nodeId, direction);

    cy.batch(() => {
      cy.nodes().addClass(PATH_FOCUS_DIM_CLASS).removeClass(PATH_FOCUS_NODE_CLASS);
      cy.edges().addClass(PATH_FOCUS_DIM_CLASS).removeClass(PATH_FOCUS_EDGE_CLASS);

      for (const id of focused.nodeIds) {
        cy.getElementById(id).removeClass(PATH_FOCUS_DIM_CLASS).addClass(PATH_FOCUS_NODE_CLASS);
      }
      for (const id of focused.edgeIds) {
        cy.getElementById(id).removeClass(PATH_FOCUS_DIM_CLASS).addClass(PATH_FOCUS_EDGE_CLASS);
      }
    });
  }

  // Otherwise the browser's own menu opens on top of ours.
  host.addEventListener('contextmenu', (event) => event.preventDefault());

  // With no button drawn on the element, the cursor is what says a right-click
  // menu is there. Cytoscape never assigns the container's cursor itself, so
  // this is ours to set.
  const setMenuCursor = (on) => {
    host.style.cursor = on ? 'context-menu' : '';
  };

  const nodeItems = (data) =>
    nodeMenuItems(data, {
      onFoldToggle,
      onGoToSource,
      canGoToSource,
      onShowInfo,
      onShowOutgoingFlow,
      onShowIncomingFlow,
      onQuery,
    });
  const edgeItems = (data) =>
    edgeMenuItems(data, { onSwapDirection, onGoToEdgeSource, canGoToEdgeSource, onShowEdgeInfo });

  if (
    onFoldToggle ||
    onGoToSource ||
    onGoToEdgeSource ||
    onShowInfo ||
    onShowEdgeInfo ||
    onSwapDirection ||
    onQuery
  ) {
    // The cursor and the menu ask the same question, so neither can advertise
    // an action the other would not offer.
    const bindMenu = (selector, itemsFor) => {
      cy.on('mouseover', selector, (evt) => setMenuCursor(itemsFor(evt.target.data()).length > 0));
      cy.on('mouseout', selector, () => setMenuCursor(false));
      cy.on('cxttap', selector, (evt) => {
        const items = itemsFor(evt.target.data());
        if (!items.length) contextMenu.close();
        else contextMenu.open(evt.renderedPosition, items);
      });
    };

    bindMenu('node', nodeItems);
    bindMenu('edge', edgeItems);
  }

  // Anything else dismisses it: any left-click, wherever it lands, a right-click
  // on the background, and panning or zooming, which would leave the menu
  // pointing at a node that has moved out from under it.
  cy.on('tap', () => contextMenu.close());
  cy.on('cxttap', (evt) => {
    if (evt.target === cy) contextMenu.close();
  });
  cy.on('pan zoom', () => contextMenu.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') contextMenu.close();
  });

  /**
   * Reports what is selected, so the shell can name it and act on it.
   *
   * Read off `cy.$(...)` rather than the event's target: cytoscape already
   * handles selecting on tap, replacing the selection (its default is single) and
   * clearing it on a background tap, so asking it what is selected covers every
   * one of those with the same line — including "nothing".
   *
   * No `tap` handler at all, which is what lets the container label band go: it
   * only ever existed to decide whether a click inside a container meant the
   * container or what was drawn there, and cytoscape's own hit-testing answers
   * that for selection.
   *
   * Nodes win when both kinds are somehow selected at once (a box selection can
   * do it, `selectionType: single` notwithstanding), so the answer is never a
   * matter of which element cytoscape happens to list first.
   */
  function reportSelection() {
    if (!onSelectionChange) return;
    const nodes = cy.$('node:selected');
    const element = nodes.nonempty() ? nodes[0] : cy.$('edge:selected')[0];
    onSelectionChange(element ? selectionOf(element) : null);
  }

  if (onSelectionChange) cy.on('select unselect', 'node, edge', reportSelection);

  // Double-click opens the info panel. Safe as a double now that a single tap only
  // selects: the first of the two taps does the selecting, so there is nothing to
  // delay and cancel — which is what ruled a double gesture out while a single tap
  // was what opened the panel (docs/adr/0008-show-node.md). Edges answer the same
  // gesture, for the same reason and since the swap moved off their single tap
  // (docs/adr/0019-select-and-swap-edges.md).
  if (onShowInfo) cy.on('dbltap', 'node', (evt) => onShowInfo(evt.target.data()));
  if (onShowEdgeInfo) cy.on('dbltap', 'edge', (evt) => onShowEdgeInfo(evt.target.data()));

  return {
    /**
     * Redraws the graph from an RDF-derived model (see rdf/graphModel.js) and
     * returns the render's `{ nodesShown, nodesTotal, edgesShown, edgesTotal }`.
     */
    update(model, filterState) {
      // The one preference the *element set* depends on, so it is read here rather
      // than in setPrefs, which only restyles and relayouts
      // (docs/adr/0026-collapse-artifact-mediated-paths.md).
      const { elements, stats } = toCytoscapeElements(model, filterState, {
        collapseArtifactPaths: prefs.collapseArtifactPaths,
      });
      // A node removed under the pointer never fires `mouseout`, so its cursor
      // would stick — and folding rebuilds the graph from under the pointer every
      // time, since the menu item is clicked while hovering the node it folds.
      setMenuCursor(false);

      // Every render replaces the elements wholesale, which would drop the
      // selection — and folding *is* a render, as is swapping an edge's direction.
      // Without carrying it across, folding the selected node deselects it and the
      // `f` shortcut could fold but never unfold. Ids that no longer exist (a node
      // now hidden inside a fold) simply do not come back, which is the right
      // answer for them.
      const selectedIds = cy.$('node:selected').map((node) => node.id());
      const selectedEdges = cy.$('edge:selected').map((edge) => edge.data());
      cy.elements().remove();
      cy.add(elements);
      for (const id of selectedIds) cy.getElementById(id).select();
      for (const data of selectedEdges) reselectEdge(cy, data);
      // Fired even when the selection is unchanged: the node's own `folded` flag
      // has just been rewritten, so the shell's copy is stale either way.
      reportSelection();
        applyPathFocus();

      runLayout();
      return stats;
    },
    /** Switches layout algorithm (an id from LAYOUTS) and re-runs it. */
    setLayout(id) {
      layoutId = id;
      runLayout();
    },
    /**
     * Applies new visualization preferences. Always restyles; only re-runs the
     * layout for the preferences that change how much room a node needs, since
     * a re-run discards the positions the user may have dragged nodes into.
     */
    setPrefs(next) {
      const needsLayout = LAYOUT_AFFECTING.some((key) => next[key] !== prefs[key]);
      prefs = next;
      cy.style(buildStyle(prefs, iconSet));
      if (needsLayout) runLayout();
      else {
        // Not every restyle changes the band, but a stylesheet swap re-applies
        // `min-height` from the sheet, so the bypass has to be written back.
        applyContainerBands();
        cy.fit(undefined, 20);
      }
    },
    /** Turns the drawing by `steps` quarter turns clockwise (negative = counter-clockwise). */
    rotate(steps) {
      rotationSteps = normalizeSteps(rotationSteps + steps);
      rotateBy(steps);
      separateOverlaps();
      cy.fit(undefined, 20);
    },
    /**
     * Re-measures the container. The ResizeObserver above covers the usual
     * cases; this is for a caller that has just made the pane visible and wants
     * to read geometry in the same tick, before the observer's frame.
     */
    resize() {
      cy.resize();
    },
    /** Re-measures and frames the whole drawing — for a pane just brought on screen. */
    fitView() {
      cy.resize();
      cy.fit(undefined, 20);
    },

    /**
     * Selects and centres the node with this IRI, reporting the selection so the
     * header and the keyboard agree with what is highlighted.
     *
     * False when the node is not drawn — hidden by a filter, or swallowed by a
     * fold. The caller only offers this for a node it found in the current model,
     * but the model and the drawing are not the same set, and silently centring on
     * nothing would look like a bug in the query rather than in the filters.
     */
    selectNode(iri) {
      const node = cy.getElementById(iri);
      if (node.empty()) return false;
      cy.elements().unselect();
      node.select();
      cy.center(node);
      reportSelection();
      return true;
    },
    /**
     * Flashes a transient message over the drawing.
     *
     * Exposed because the shell owns the shortcuts (docs/adr/0013-graph-view-controls.md)
     * but not the container: `s` on an edge with no inverse property has to say so,
     * and it must say it the same way and in the same place the graph already does.
     */
    flashError(message) {
      flashEdgeError(host, message);
    },
      setPathFocus(nodeId, direction) {
        if (!PATH_FOCUS_DIRECTIONS.has(direction)) return false;
        pathFocus = { nodeId, direction };
        applyPathFocus();
        return Boolean(pathFocus);
      },
      clearPathFocus() {
        pathFocus = null;
        clearPathFocusClasses();
      },
      hasPathFocus() {
        return Boolean(pathFocus);
      },
  };
}
