import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import { toCytoscapeElements } from './toCytoscape.js';
import {
  DEFAULT_LAYOUT_ID,
  layoutOptions,
  normalizeSteps,
  rotatePoint,
  supportsFlowRoot,
  supportsTierLayering,
} from './layouts.js';
import { TIER_FLOW_KINDS, layoutRoots, tierLayers } from './tierLayers.js';
import {
  PATH_FOCUS_DEPTH_CLASSES,
  SEARCH_FOCUS_CLASS,
  SEARCH_HIT_CLASS,
  buildStyle,
  pathFocusDepthBand,
  pathFocusDepthClass,
} from './graphStyle.js';
import {
  DEFAULT_PREFS,
  containerLabelBandFor,
  drawnLabel,
  estimatedLabelLines,
} from './graphPrefs.js';
import { separateSiblings, siblingLevels } from './separateSiblings.js';
import { loadIconSet } from './icons.js';
import { edgeMenuItems, nodeMenuItems } from './nodeMenu.js';
import { matchNodes } from './nodeSearch.js';
import { directionalFlow } from './pathFocus.js';
import { anchoredViewport } from './viewAnchor.js';

cytoscape.use(elk);

/** Preferences that feed the layout, so changing them costs a re-run and not just a restyle. */
const LAYOUT_AFFECTING = [
  'nodeSpacing',
  'nodeSize',
  'fontSize',
  'nodeStyle',
  'containerPadding',
  // Two fewer lines on every node is two fewer lines of room a container needs.
  'labelDetail',
  // And one more line on every located node is one more, for the same reason — plus
  // the box view reparents, which moves everything.
  'locationView',
];
const PATH_FOCUS_DIRECTIONS = new Set(['outgoing', 'incoming']);
const PATH_FOCUS_DIM_CLASS = 'path-focus-dim';
const PATH_FOCUS_NODE_CLASS = 'path-focus-node';
const PATH_FOCUS_EDGE_CLASS = 'path-focus-edge';
const PATH_FOCUS_DEPTH_CLASS_LIST = PATH_FOCUS_DEPTH_CLASSES.join(' ');

/**
 * How long the halo marking the node a search landed on stays lit. The same two
 * seconds as the edge toast above and the editor's reveal flash
 * (editor/revealFlash.js) — a jump that lands somewhere says "here", then gets
 * out of the way, and it should say it for the same length of time wherever it
 * happens.
 */
const SEARCH_FLASH_MS = 2000;

/**
 * Least zoom a searched-for node is shown at.
 *
 * The focus never zooms *out* — a reader who zoomed in did so on purpose — so
 * this is only ever a floor, and it exists for the one case search is for: the
 * whole diagram framed, every node an unreadable speck, and the match no more
 * legible than anything else. At 1 the node is drawn at its natural size, which
 * is the size the label was laid out for.
 */
const SEARCH_ZOOM_FLOOR = 1;

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

/** How far below and right of the pointer the hover tooltip sits, so it clears the cursor. */
const TOOLTIP_OFFSET = 12;

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

/**
 * The identity of the node under the pointer, for when the drawing is holding it
 * back — `labelDetail: 'name'` draws the name alone and this is where the id and
 * the rdf:type go (docs/adr/0015-graph-visualization-preferences.md).
 *
 * Like the flash toast and unlike the context menu, it is `pointer-events: none`.
 * Not decoration: cytoscape reads an event anywhere inside its container as a
 * canvas event, so an interactive child has to stop propagation to stay usable
 * (see `createContextMenu` above). A tooltip has nothing to click, so letting the
 * pointer through is both simpler and correct — it can never take the hover from
 * the node that opened it.
 *
 * Its CSS must not set `display`, only `[hidden]`-compatible properties: an author
 * `display` outranks the UA rule for `[hidden]`, and a tooltip that cannot hide is
 * a permanent box inside the cytoscape container, changing the client size that
 * `cy.resize()` measures. The same trap `.pane[hidden]` documents in app.css.
 */
function createNodeTooltip(host) {
  const tip = document.createElement('div');
  tip.className = 'graph-node-tooltip';
  tip.hidden = true;
  host.appendChild(tip);

  function hide() {
    tip.hidden = true;
    tip.replaceChildren();
  }

  /** Shows one row per `[term, value]` at `position` in the host; no rows, no tooltip. */
  function show(position, rows) {
    if (!rows.length) return hide();
    tip.replaceChildren();
    for (const [term, value] of rows) {
      const row = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'graph-node-tooltip-term';
      name.textContent = `${term} `;
      row.append(name, document.createTextNode(value));
      tip.appendChild(row);
    }

    // Measured only once visible — a hidden element has no size — then pulled back
    // inside the host, the same clamp the context menu does and for the same reason.
    tip.hidden = false;
    const bounds = host.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const x = Math.min(position.x + TOOLTIP_OFFSET, bounds.width - box.width);
    const y = Math.min(position.y + TOOLTIP_OFFSET, bounds.height - box.height);
    tip.style.left = `${Math.max(0, x)}px`;
    tip.style.top = `${Math.max(0, y)}px`;
  }

  return { show, hide };
}

/**
 * The find bar: a text box over the drawing that narrows it to the nodes whose
 * name contains what is typed (docs/adr/0042-find-and-focus-node.md).
 *
 * A plain DOM child of the cytoscape container, like the context menu and the
 * tooltip, and interactive like the menu — so it carries the menu's warning
 * too: cytoscape binds its pointer handlers to the *container* and reads an
 * event anywhere inside it as a canvas event, so without stopping them here a
 * click in the input is also read as a click on the background, whose handler
 * would dismiss things out from under it.
 *
 * Keystrokes are deliberately *not* stopped. The shell's keydown listener is on
 * `window` in the capture phase, so stopping propagation here would not reach it
 * anyway — what keeps `f` from folding while the user types it is `isTypingTarget`
 * (main.js), which already declines every bare graph key whose target is an
 * input. One guard, in the place that owns the shortcuts.
 *
 * `onInput`, `onStep`, `onCommit` and `onClose` are the four things a find bar
 * can be asked for: narrow, walk the hits, take this one, give up.
 */
function createSearchBar(host, { onInput, onStep, onCommit, onClose }) {
  const bar = document.createElement('div');
  bar.className = 'graph-search';
  bar.hidden = true;

  // `text`, not `search`: the browser's search field swallows Escape, and Escape
  // is how this closes. The same trap filterChip.js documents on its own box.
  const input = document.createElement('input');
  input.type = 'text';
  // Both classes: the chips' search box is the one this borrows its looks from,
  // and the second only narrows it to something that fits over a canvas.
  input.className = 'filter-popover-search graph-search-input';
  input.placeholder = 'Find a node…';
  input.setAttribute('aria-label', 'Find a node');

  // How many nodes answer to what has been typed, and which of them the view is
  // sitting on. Without it an empty-looking result is indistinguishable from a
  // drawing where everything happens to match.
  const count = document.createElement('span');
  count.className = 'graph-search-count';

  bar.append(input, count);
  host.appendChild(bar);

  for (const type of ['mousedown', 'mouseup', 'click']) {
    bar.addEventListener(type, (event) => event.stopPropagation());
  }

  function close() {
    bar.hidden = true;
    input.value = '';
    count.textContent = '';
  }

  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('keydown', (event) => {
    // Arrows walk the hits and must not also move the caret; Enter and Escape
    // have no default here worth keeping either.
    const handled = {
      Enter: onCommit,
      Escape: onClose,
      ArrowDown: () => onStep(1),
      ArrowUp: () => onStep(-1),
    }[event.key];
    if (!handled) return;
    event.preventDefault();
    handled();
  });

  return {
    open() {
      bar.hidden = false;
      input.value = '';
      count.textContent = '';
      input.focus();
    },
    close,
    /**
     * `index` is 1-based and 0 means "not landed on one yet", which is the state
     * right after typing: the hits are lit but the view has not moved.
     */
    setCount(total, index) {
      if (!total) {
        count.textContent = input.value.trim() ? 'no match' : '';
        return;
      }
      count.textContent = index ? `${index}/${total}` : `${total}`;
    },
  };
}

export function createGraphPane(host, {
  onShowInfo,
  onShowEdgeInfo,
  onShowOutgoingFlow,
  onShowIncomingFlow,
  onStepOutgoingFlow,
  onStepIncomingFlow,
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
  // The node the reading starts from: pinned to the leftmost layer by whichever
  // ELK layout is running (docs/adr/0035-improve-flow-discovery.md). Pane state
  // for the same reason `rotationSteps` is — a filter change or a new selection
  // must not silently give the drawing a different starting point.
  let flowRootId = null;
  let iconSet = null;
  let pathFocus = null;
  // The running find, or null when the bar is shut: `{ query, matches, index,
  // stepped }`. `matches` is re-derived from the drawing on every redraw rather
  // than remembered, so a node a fold has just swallowed stops being a hit
  // instead of becoming an id that no longer resolves. `stepped` is what tells
  // "the first hit" from "the hit the reader walked to", so the first ArrowDown
  // lands on the first match rather than skipping it.
  let search = null;
  let searchFlashTimer = null;

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
      const band = containerLabelBandFor(
        prefs,
        estimatedLabelLines(drawnLabel(node.data(), prefs), prefs.fontSize),
      );
      const children = node.children().boundingBox({
        includeLabels: true,
        includeOverlays: false,
        useCache: false,
      });
      node.style('min-height', children.h + band);
    }
  }

  /**
   * Where a node is drawn right now, for `restoreAnchor` to put it back after the
   * layout has moved it. Null when there is nothing to anchor on, which is the
   * caller's cue to frame the whole drawing instead.
   *
   * Has to be read before the elements are replaced: afterwards the old node is
   * gone and its rendered position with it.
   */
  function captureAnchor(iri) {
    if (!iri) return null;
    const node = cy.getElementById(iri);
    if (node.empty()) return null;
    return { id: iri, rendered: { ...node.renderedPosition() }, zoom: cy.zoom() };
  }

  /**
   * Puts the anchored node back under the pixel it was drawn at, keeping the zoom.
   *
   * False when there is no anchor, or when the node did not survive the render —
   * folding an ancestor swallows it — so the caller can fall back to fitting
   * rather than leaving the viewport pointing at empty space. One `viewport` call
   * rather than `zoom` then `pan`: two calls draw two frames, and the zoom alone
   * would first move the view about the wrong point.
   */
  function restoreAnchor(anchor) {
    if (!anchor) return false;
    const node = cy.getElementById(anchor.id);
    if (node.empty()) return false;
    cy.viewport(anchoredViewport(anchor.rendered, anchor.zoom, node.position()));
    return true;
  }

  /**
   * The drawn graph as plain records, which is what the graph walks take: they are pure
   * functions of a shape, testable without a cytoscape instance (viz/tierLayers.js,
   * viz/pathFocus.js).
   */
  function drawnRecords() {
    return {
      nodes: cy.nodes().map((node) => ({
        id: node.id(),
        isParent: node.isParent(),
        parentId: node.data('parent') ?? null,
      })),
      edges: cy.edges().map((edge) => ({
        id: edge.id(),
        source: edge.data('source'),
        target: edge.data('target'),
        kind: edge.data('kind'),
        // A two-way link is one element standing for the relation asserted each way, so a
        // walk that reads direction has to know which it is looking at.
        bidirectional: edge.data('bidirectional'),
      })),
    };
  }

  /**
   * Runs the current layout, re-applying the pending rotation once it settles.
   *
   * With an `anchor` (from `captureAnchor`) the view stays where the reader left
   * it instead of being refitted. Both happen at the end of `layoutstop`, after
   * the rotation, the bands and the overlap separation: those passes move nodes,
   * so anchoring any earlier would leave the node off by however far it was then
   * nudged.
   */
  function runLayout(anchor = null) {
    const view = { rootId: flowRootId };
    // What the layout is run over. Normally everything drawn; under tier layering the
    // non-flow links are held back, because a partition orders the tiers but an edge still
    // forces its target into a later one — a `db → standby` link would push the replica
    // past the tier it was computed into. cytoscape-elk reads node positions back and
    // nothing else, so the routing those links would have got is no loss, and they stay on
    // screen either way: this is the layout's input, not the drawing's.
    let eles;
    if (supportsTierLayering(layoutId)) {
      const { nodes, edges } = drawnRecords();
      view.tiers = tierLayers(nodes, edges, { rootId: flowRootId });
      eles = cy
        .nodes()
        .union(cy.edges().filter((edge) => TIER_FLOW_KINDS.includes(edge.data('kind'))));
    } else if (layoutId === 'breadthfirst') {
      const { nodes, edges } = drawnRecords();
      // Over every drawn link, not only the flow ones: these decide what the walk can
      // reach, and a node it cannot reach is drawn in a row *above* the first one.
      view.roots = layoutRoots(nodes, edges, flowRootId);
    }

    const layout = cy.layout({ ...layoutOptions(layoutId, prefs, view), ...(eles ? { eles } : {}) });
    layout.one('layoutstop', () => {
      rotateBy(rotationSteps);
      // Before separating: the band is part of a container's box, so overlaps have
      // to be judged against the box that will actually be drawn.
      applyContainerBands();
      // After the rotation, which turns the node boxes but not the labels inside
      // them — a drawing with no overlaps can gain some on a quarter turn.
      separateOverlaps();
      if (!restoreAnchor(anchor)) cy.fit(undefined, 20);
    });
    layout.run();
  }

  /**
   * Pins `nodeId` to the leftmost layer and re-lays the drawing out around it,
   * or clears the pin when it is already the root or the id is null
   * (docs/adr/0035-improve-flow-discovery.md).
   *
   * False when the running layout has no layers, so both callers — the key and
   * the menu — can say why nothing moved instead of looking broken. Anchored on
   * the node itself, the way a fold is: the node the reader is looking at
   * should hold still while the rest rearranges around it.
   */
  function applyFlowRoot(nodeId) {
    if (!supportsFlowRoot(layoutId)) return false;
    const next = nodeId && nodeId !== flowRootId ? nodeId : null;
    flowRootId = next;
    runLayout(captureAnchor(next ?? nodeId));
    return true;
  }

  const onSetFlowRoot = (nodeId) => {
    if (!applyFlowRoot(nodeId)) {
      flashEdgeError(host, 'this layout cannot start the reading from a node — try ELK layered or breadth-first');
    }
  };

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
  const nodeTooltip = createNodeTooltip(host);
  const edgeTooltip = createNodeTooltip(host);
  const searchBar = createSearchBar(host, {
    onInput: runSearch,
    onStep: stepSearch,
    onCommit: commitSearch,
    onClose: closeSearch,
  });
  function clearPathFocusClasses() {
    cy.batch(() => {
      cy.nodes().removeClass(
        `${PATH_FOCUS_DIM_CLASS} ${PATH_FOCUS_NODE_CLASS} ${PATH_FOCUS_DEPTH_CLASS_LIST}`,
      );
      cy.edges().removeClass(
        `${PATH_FOCUS_DIM_CLASS} ${PATH_FOCUS_EDGE_CLASS} ${PATH_FOCUS_DEPTH_CLASS_LIST}`,
      );
    });
  }

  function applyPathFocus() {
    if (!pathFocus) {
      clearPathFocusClasses();
      return;
    }

    const { nodeId, direction, maxDepth } = pathFocus;
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

    // A two-way link is one element standing for the relation asserted each way, so the
    // flow can be followed along it in either direction; `drawnRecords` carries that.
    const { nodes, edges } = drawnRecords();
    const focused = directionalFlow(
      nodes.map((node) => node.id),
      edges,
      nodeId,
      direction,
      { maxDepth },
    );
    // What the shell needs to tell "extended by a hop" from "that is the whole
    // flow": the walk knows, and reachability alone does not say.
    pathFocus.truncated = focused.truncated;

    cy.batch(() => {
      cy.nodes()
        .addClass(PATH_FOCUS_DIM_CLASS)
        .removeClass(`${PATH_FOCUS_NODE_CLASS} ${PATH_FOCUS_DEPTH_CLASS_LIST}`);
      cy.edges()
        .addClass(PATH_FOCUS_DIM_CLASS)
        .removeClass(`${PATH_FOCUS_EDGE_CLASS} ${PATH_FOCUS_DEPTH_CLASS_LIST}`);

      const band = (depth) => (depth ? pathFocusDepthClass(pathFocusDepthBand(depth)) : '');
      for (const id of focused.nodeIds) {
        cy.getElementById(id)
          .removeClass(PATH_FOCUS_DIM_CLASS)
          .addClass(`${PATH_FOCUS_NODE_CLASS} ${band(focused.depths.get(id))}`.trim());
      }
      for (const id of focused.edgeIds) {
        cy.getElementById(id)
          .removeClass(PATH_FOCUS_DIM_CLASS)
          .addClass(`${PATH_FOCUS_EDGE_CLASS} ${band(focused.edgeDepths.get(id))}`.trim());
      }
    });
  }

  /** The drawn nodes as the matcher takes them (viz/nodeSearch.js). */
  function searchRecords() {
    return cy.nodes().map((node) => ({
      id: node.id(),
      displayId: node.data('displayId'),
      name: node.data('name'),
    }));
  }

  function clearSearchClasses() {
    clearTimeout(searchFlashTimer);
    cy.batch(() => {
      cy.nodes().removeClass(
        `${PATH_FOCUS_DIM_CLASS} ${SEARCH_HIT_CLASS} ${SEARCH_FOCUS_CLASS}`,
      );
      cy.edges().removeClass(PATH_FOCUS_DIM_CLASS);
    });
  }

  /**
   * Lights the hits and dims the rest.
   *
   * Said in the path focus's own dim class rather than a second one of its own:
   * "these are the elements in play, and those are not" is one thing to tell a
   * reader, and it should look the same whether the set came from a flow walk or
   * from a name. Which is also why the two are mutually exclusive — see
   * `openSearch`.
   *
   * A query that matches nothing dims nothing: a drawing gone uniformly faint
   * says less than the bar's own "no match", and leaving it alone keeps the
   * mistyped keystroke cheap to undo.
   */
  function applySearchHighlight() {
    if (!search?.matches.length) {
      clearSearchClasses();
      return;
    }
    cy.batch(() => {
      cy.nodes().addClass(PATH_FOCUS_DIM_CLASS).removeClass(SEARCH_HIT_CLASS);
      cy.edges().addClass(PATH_FOCUS_DIM_CLASS);
      for (const id of search.matches) {
        cy.getElementById(id).removeClass(PATH_FOCUS_DIM_CLASS).addClass(SEARCH_HIT_CLASS);
      }
    });
  }

  /**
   * Centres `id` and makes sure it is big enough to read, then flashes it.
   *
   * The zoom is only ever raised: a reader who zoomed in did so to look at
   * something, and a search that pulled the view back out would undo the work it
   * was run in the middle of. `anchoredViewport` (viz/viewAnchor.js) already
   * inverts cytoscape's `rendered = position * zoom + pan`, which is exactly
   * "draw this node under that pixel at that zoom" — and one `viewport` call
   * rather than `zoom` then `pan` for the reason `restoreAnchor` gives: two
   * calls draw two frames, and the zoom alone would first move the view about
   * the wrong point.
   *
   * The halo is what the editor's reveal flash is: the viewport having moved is
   * not by itself a signal when the eye was somewhere else a moment ago.
   */
  function focusNode(id) {
    const node = cy.getElementById(id);
    if (node.empty()) return false;
    const bounds = host.getBoundingClientRect();
    cy.viewport(
      anchoredViewport(
        { x: bounds.width / 2, y: bounds.height / 2 },
        Math.max(cy.zoom(), SEARCH_ZOOM_FLOOR),
        node.position(),
      ),
    );
    clearTimeout(searchFlashTimer);
    cy.nodes().removeClass(SEARCH_FOCUS_CLASS);
    node.addClass(SEARCH_FOCUS_CLASS);
    searchFlashTimer = setTimeout(() => node.removeClass(SEARCH_FOCUS_CLASS), SEARCH_FLASH_MS);
    return true;
  }

  /**
   * Re-runs the query over what is drawn now.
   *
   * The view deliberately does not move: the hits light up where they are, and
   * going to one is a separate press. A search that panned on every keystroke
   * would drag the drawing about under a reader who is still typing.
   */
  function runSearch(query) {
    search = { query, matches: matchNodes(searchRecords(), query), index: 0, stepped: false };
    applySearchHighlight();
    searchBar.setCount(search.matches.length, 0);
  }

  /** Walks the hits, wrapping. The first press lands on a hit rather than past it. */
  function stepSearch(delta) {
    if (!search?.matches.length) return;
    const total = search.matches.length;
    if (search.stepped) search.index = (search.index + delta + total) % total;
    else {
      search.stepped = true;
      // Stepping backwards from nowhere means the last hit, the way a wrap would.
      if (delta < 0) search.index = total - 1;
    }
    focusNode(search.matches[search.index]);
    searchBar.setCount(total, search.index + 1);
  }

  function closeSearch() {
    if (!search) return;
    search = null;
    clearSearchClasses();
    searchBar.close();
  }

  /**
   * Takes the hit the bar is sitting on: it becomes the selection, the view goes
   * to it, and the mermaid line it was written on is revealed.
   *
   * That last step is the shell's — the view is not allowed to know mermaid
   * exists (docs/adr/0014-graph-view-from-rdf-only.md) — so it goes out through
   * the same two callbacks the context menu's "Go to mermaid source" uses, and a
   * node with no mermaid origin simply gets no jump, exactly as it gets no menu
   * item.
   *
   * The bar shuts first, so the dimming is gone by the time the reader looks at
   * where they landed: the question has been answered, and the rest of the
   * drawing is the context for the answer.
   */
  function commitSearch() {
    const id = search?.matches[search.index];
    // Nothing to take, so nothing happens — and nothing is said either: the bar
    // is already reading "no match", and the toast that would say it again is
    // drawn in the same place the bar is sitting.
    if (!id) return;
    closeSearch();
    cy.elements().unselect();
    cy.getElementById(id).select();
    focusNode(id);
    reportSelection();
    if (canGoToSource?.(id)) onGoToSource?.(id);
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
      onStepOutgoingFlow,
      onStepIncomingFlow,
      onSetFlowRoot,
      isFlowRoot: data.id === flowRootId,
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
  // The hover tooltip, which only has something to say when the drawing is holding
  // something back. In `full` mode the node already shows its id and its type, and
  // repeating them on every hover would be noise.
  cy.on('mouseover', 'node', (evt) => {
    if (prefs.labelDetail !== 'name') return;
    const data = evt.target.data();
    const rows = [
      ['id', data.displayId],
      ['type', data.rdfType],
    ].filter(([, value]) => value);
    nodeTooltip.show(evt.renderedPosition, rows);
  });
  cy.on('mouseout', 'node', () => nodeTooltip.hide());

  // A %% comment block the author attached to the edge's mermaid line
  // (parser/tokenizer.js, rdf/emit.js) — new information regardless of
  // `labelDetail`, so unlike the node tooltip above this is not gated on it.
  cy.on('mouseover', 'edge', (evt) => {
    const data = evt.target.data();
    if (!data.comment) return;
    edgeTooltip.show(evt.renderedPosition, [['comment', data.comment]]);
  });
  cy.on('mouseout', 'edge', () => edgeTooltip.hide());

  cy.on('tap', () => {
    contextMenu.close();
    nodeTooltip.hide();
    edgeTooltip.hide();
  });
  cy.on('cxttap', (evt) => {
    if (evt.target === cy) contextMenu.close();
  });
  // The tooltip goes too: `mouseout` does not fire when the node moves out from
  // under a stationary pointer.
  cy.on('pan zoom', () => {
    contextMenu.close();
    nodeTooltip.hide();
    edgeTooltip.hide();
  });
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
     *
     * `anchorNode` is the IRI of a node to keep still: the drawing is re-laid out
     * around it rather than refitted, so a fold — a local action on a node the
     * reader is already looking at — does not throw away their zoom and send them
     * back to the whole graph. Without it the render frames everything, which is
     * the right answer when the whole drawing has changed.
     */
    update(model, filterState, { anchorNode } = {}) {
      // The two preferences the *elements* depend on, so they are read here
      // rather than in setPrefs, which only restyles and relayouts
      // (docs/adr/0026-collapse-artifact-mediated-paths.md,
      // docs/adr/0035-improve-flow-discovery.md).
      const { elements, stats } = toCytoscapeElements(model, filterState, {
        collapseArtifactPaths: prefs.collapseArtifactPaths,
        orientByFlow: prefs.orientByFlow,
        locationView: prefs.locationView,
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
      const anchor = captureAnchor(anchorNode);
      cy.elements().remove();
      cy.add(elements);
      for (const id of selectedIds) cy.getElementById(id).select();
      for (const data of selectedEdges) reselectEdge(cy, data);
      // Fired even when the selection is unchanged: the node's own `folded` flag
      // has just been rewritten, so the shell's copy is stale either way.
      reportSelection();
      applyPathFocus();
      // The classes went with the elements that carried them, and what matches
      // may have changed with them — a fold swallows nodes, a filter hides them.
      // Re-run rather than re-apply, and let the walk start over: "the third
      // hit" means something else in a drawing that is no longer the same one.
      if (search) runSearch(search.query);

      runLayout(anchor);
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
    /**
     * Starts the reading from this node: it is pinned to the leftmost layer and
     * the drawing is re-laid out around it. Passing the current root, or null,
     * clears the pin.
     *
     * Returns false when the running layout has no layers to pin to, so the
     * caller can say why nothing moved rather than leaving a key looking broken.
     * Anchored on the root itself, the way a fold anchors on the node it folds:
     * the node the reader is looking at should not jump when the rest of the
     * drawing rearranges around it.
     */
    setFlowRoot(nodeId) {
      return applyFlowRoot(nodeId);
    },
    /** The node the reading currently starts from, or null. */
    flowRoot() {
      return flowRootId;
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
     * Opens the find bar and puts the caret in it.
     *
     * Clears any path focus on the way in: the two say what they have to say in
     * the same dim class, so they cannot both be on screen, and the one just
     * asked for is the one the reader wants. Re-opening an already open bar
     * empties it, which is what a second `/` means — start again.
     */
    openSearch() {
      pathFocus = null;
      clearPathFocusClasses();
      search = { query: '', matches: [], index: 0, stepped: false };
      searchBar.open();
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
      /**
       * `maxDepth` bounds the walk in hops, and defaults to unbounded so that
       * `>` / `<` keep showing the whole flow. `applyPathFocus` re-runs the walk
       * after every redraw, so the bound is state rather than a one-off result.
       */
      setPathFocus(nodeId, direction, maxDepth = Infinity) {
        if (!PATH_FOCUS_DIRECTIONS.has(direction)) return false;
        // The two share the dim class, so they share the drawing: whichever was
        // asked for last is the one the reader meant.
        closeSearch();
        pathFocus = { nodeId, direction, maxDepth, truncated: false };
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
      /**
       * The focus as it stands, or null. `truncated` is what the stepped walk
       * dispatches on: extending a focus that already reaches everything would
       * redraw nothing, so the shell has to say so instead
       * (docs/adr/00032-improve-flow-discovery.md).
       */
      pathFocusReach() {
        if (!pathFocus) return null;
        const { nodeId, direction, maxDepth, truncated } = pathFocus;
        return { nodeId, direction, maxDepth, truncated };
      },
  };
}
