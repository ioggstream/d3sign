/**
 * The layout algorithms offered by the graph pane's dropdown, plus the pure
 * geometry behind its rotate buttons.
 *
 * Only algorithms bundled with cytoscape core or cytoscape-elk are listed, so
 * switching layouts never pulls in another dependency and works offline.
 * `hierarchical: true` marks the ones that honour compound (container) nodes;
 * the others flatten them, which is fine but worth knowing when a diagram uses
 * containers. None of them *guarantee* that a node stays out of a container that
 * does not hold it — the flat ones position children on a global grid with no
 * knowledge of their parent, and `cose` treats it as a repulsive force — so
 * viz/separateSiblings.js enforces that afterwards, whichever ran.
 *
 * Spacing is not baked in: `layoutOptions(id, prefs)` derives it from the view
 * preferences (viz/graphPrefs.js), so the "node spacing" slider means the same
 * thing whichever algorithm is running. Every entry is a pure function of its
 * arguments, so this module stays testable without a browser.
 */

import {
  DEFAULT_PREFS,
  containerLabelBand,
  containerLabelBandFor,
  containerSideGutter,
  drawnLabel,
  estimatedLabelLines,
} from './graphPrefs.js';

/** The spacing the sliders are calibrated against; ratios below are relative to it. */
const BASELINE_SPACING = DEFAULT_PREFS.nodeSpacing;

/**
 * The gutter one container reserves, as ELK's `ElkPadding` string.
 *
 * Unlike cytoscape, ELK really does take four numbers, and it has to be given the
 * four cytoscape draws or a neighbour is laid out inside the container's box. What
 * cytoscape draws is the side gutter on every side, plus — on top only — the label
 * band, which reaches the drawing as extra node height rather than as padding
 * (see the geometry note in graphPrefs.js).
 */
export function elkPaddingFor(prefs, lines) {
  const side = containerSideGutter(prefs);
  const top = side + containerLabelBandFor(prefs, lines);
  return `[top=${top},left=${side},bottom=${side},right=${side}]`;
}

/** The widest gutter any container can need, for the root graph's own margin. */
export function elkPadding(prefs) {
  const side = containerSideGutter(prefs);
  const top = side + containerLabelBand(prefs);
  return `[top=${top},left=${side},bottom=${side},right=${side}]`;
}

function elkSpacing(prefs) {
  const spacing = prefs.nodeSpacing;
  return {
    'elk.spacing.nodeNode': spacing,
    'elk.spacing.edgeEdge': Math.round(spacing / 3),
    'elk.spacing.edgeNode': Math.round(spacing / 3),
    // `layered` separates connected components by default, and then it is this
    // spacing — not nodeNode — that keeps an unrelated node away from a
    // container that shares no edge with it.
    'elk.spacing.componentComponent': spacing,
    // The root graph's own margin, not any container's: those are set per node
    // below. The worst case costs nothing here.
    'elk.padding': elkPadding(prefs),
  };
}

/**
 * Per-node ELK options: each container's own padding, matching what the
 * stylesheet draws around it.
 *
 * cytoscape-elk sets the options object on the root graph only, and ELK documents
 * inheritance for `hierarchyHandling` alone — so without this a nested container
 * falls back to ELK's default padding of 12 while cytoscape draws a much larger
 * gutter, and its children's box overflows it. It is doubly needed now that the
 * gutter differs per container: there is no one value the root could carry.
 */
function elkNodeOptions(prefs, rootId) {
  return (node) => {
    const options = node.isParent()
      ? {
          'elk.padding': elkPaddingFor(
            prefs,
            estimatedLabelLines(drawnLabel(node.data(), prefs), prefs.fontSize),
          ),
        }
      : {};
    // The node the reading starts from, pinned to the leftmost layer
    // (docs/adr/0035-improve-flow-discovery.md). Merged rather than substituted:
    // a container can be the root too, and it still needs its padding. Only
    // `layered` has layers, and every other algorithm ignores the key.
    if (rootId && node.id() === rootId) {
      options['elk.layered.layering.layerConstraint'] = 'FIRST';
    }
    return Object.keys(options).length ? options : undefined;
  };
}

/**
 * Which edges ELK's greedy cycle breaker may not sacrifice.
 *
 * cytoscape-elk skips any edge this returns a non-nil value for, so an edge
 * that states an order survives a cycle formed with anything else: reversing
 * one to break a cycle would draw a sequence running backwards.
 *
 * Which links those are is a fact about the vocabulary, so it arrives on the
 * element as `sequence` (rdf/flowPolarity.js → rdf/graphModel.js →
 * viz/toCytoscape.js) rather than being looked up here. That is what keeps this
 * module pure geometry, and it is the same route `kind` and the effect keys
 * already take to the stylesheet.
 */
function sequencePriority(edge) {
  return edge.data('sequence') ? 1 : null;
}

function elkLayout(algorithm, extra = () => ({})) {
  return (prefs, view = {}) => ({
    name: 'elk',
    nodeDimensionsIncludeLabels: true,
    nodeLayoutOptions: elkNodeOptions(prefs, view.rootId),
    priority: sequencePriority,
    elk: {
      algorithm,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      ...elkSpacing(prefs),
      ...extra(prefs),
    },
  });
}

/** Cytoscape's own layouts take a single multiplier instead of explicit gaps. */
function spacingFactor(prefs) {
  return prefs.nodeSpacing / BASELINE_SPACING;
}

export const LAYOUTS = [
  {
    id: 'elk-layered',
    label: 'ELK layered',
    hierarchical: true,
    options: elkLayout('layered', (prefs) => ({
      // ELK's own default for `layered`, so this changes no drawing. It is
      // written down because the flow orientation and the layer-0 root both
      // assume left-to-right, and a silent default is a poor thing for two
      // features to rest on. Rotation remains the general orientation control
      // (docs/adr/0013-graph-view-controls.md); this adds none.
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': Math.round(prefs.nodeSpacing * 1.33),
      'elk.layered.spacing.edgeNodeBetweenLayers': Math.round(prefs.nodeSpacing * 0.66),
    })),
  },
  { id: 'elk-mrtree', label: 'ELK tree', hierarchical: true, options: elkLayout('mrtree') },
  { id: 'elk-stress', label: 'ELK stress', hierarchical: true, options: elkLayout('stress') },
  { id: 'elk-force', label: 'ELK force', hierarchical: true, options: elkLayout('force') },
  { id: 'elk-radial', label: 'ELK radial', hierarchical: true, options: elkLayout('radial') },
  {
    id: 'cose',
    label: 'Force (cose) - Data Flows',
    hierarchical: true,
    options: (prefs) => ({
      name: 'cose',
      nodeDimensionsIncludeLabels: true,
      animate: false,
      padding: 20,
      idealEdgeLength: prefs.nodeSpacing,
      nodeRepulsion: 400000 * spacingFactor(prefs),
    }),
  },
  {
    id: 'breadthfirst',
    label: 'Breadth-first',
    hierarchical: false,
    options: (prefs) => ({
      name: 'breadthfirst',
      nodeDimensionsIncludeLabels: true,
      directed: true,
      spacingFactor: 1.2 * spacingFactor(prefs),
      padding: 20,
    }),
  },
  {
    id: 'concentric',
    label: 'Concentric',
    hierarchical: false,
    options: (prefs) => ({
      name: 'concentric',
      nodeDimensionsIncludeLabels: true,
      spacingFactor: spacingFactor(prefs),
      padding: 20,
    }),
  },
  {
    id: 'circle',
    label: 'Circle',
    hierarchical: false,
    options: (prefs) => ({
      name: 'circle',
      nodeDimensionsIncludeLabels: true,
      spacingFactor: spacingFactor(prefs),
      padding: 20,
    }),
  },
  {
    id: 'grid',
    label: 'Grid',
    hierarchical: false,
    options: (prefs) => ({
      name: 'grid',
      nodeDimensionsIncludeLabels: true,
      spacingFactor: spacingFactor(prefs),
      padding: 20,
    }),
  },
];

export const DEFAULT_LAYOUT_ID = 'elk-layered';

/**
 * Whether a layout can start the reading from a chosen node.
 *
 * Only `layered` has layers to pin one to. Every other algorithm silently
 * ignores `layerConstraint`, and silence is the wrong answer to a keystroke:
 * the caller says so instead (docs/adr/0035-improve-flow-discovery.md).
 */
export function supportsFlowRoot(id) {
  return id === 'elk-layered';
}

/**
 * Centres a node's box on the coordinate the layout produced for it.
 *
 * Every layout here runs with `nodeDimensionsIncludeLabels`, so what each one
 * reserves room for is the node's *label-inclusive* box, centred on the position
 * it hands back — an ELK slot, a grid cell, a point on a cose ring. But cytoscape
 * reads that position as the node's own centre, and a leaf draws its label
 * underneath itself, so the box actually drawn there is *not* centred on it: it
 * overflows downwards by half the label and leaves the same slack above. That is
 * why gaps a layout had reserved came out smaller on screen, and why a container —
 * whose box cytoscape derives from its children's label-inclusive boxes — grew past
 * the room kept clear around it.
 *
 * Moving the node up by half its label puts the box back where the layout meant
 * it. Cytoscape applies this to every non-parent node, which is exactly the set
 * any layout positions.
 */
export function labelAnchorTransform(node, position) {
  const reserved = node.layoutDimensions({ nodeDimensionsIncludeLabels: true });
  // Horizontally a leaf's label is centred on it, so only the vertical extent
  // disagrees.
  return { x: position.x, y: position.y + node.outerHeight() / 2 - reserved.h / 2 };
}

function layoutEntry(id) {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID);
}

/**
 * Cytoscape layout options for a dropdown id, falling back to the default.
 *
 * `view` carries what the *drawing* asks of the layout rather than what the
 * preferences do: `rootId` is the node the reading starts from
 * (docs/adr/0035-improve-flow-discovery.md). Only the ELK entries read it; the
 * cytoscape-native ones take their single spacing multiplier and ignore it,
 * which is why it is passed to `options` rather than merged in here.
 */
export function layoutOptions(id, prefs = DEFAULT_PREFS, view = {}) {
  // Applied here rather than per entry: it corrects how cytoscape reads any
  // layout's output, so no entry may be without it.
  return { ...layoutEntry(id).options(prefs, view), transform: labelAnchorTransform };
}

/** Normalizes any integer number of quarter turns to 0..3. */
export function normalizeSteps(steps) {
  return ((steps % 4) + 4) % 4;
}

/**
 * Rotates `point` around `center` by `steps` quarter turns clockwise on screen
 * (y grows downwards, so a clockwise quarter turn maps (dx, dy) to (-dy, dx)).
 */
export function rotatePoint(point, center, steps) {
  let dx = point.x - center.x;
  let dy = point.y - center.y;
  for (let i = normalizeSteps(steps); i > 0; i -= 1) {
    [dx, dy] = [-dy, dx];
  }
  return { x: center.x + dx, y: center.y + dy };
}
