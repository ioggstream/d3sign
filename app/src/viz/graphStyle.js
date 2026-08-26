/**
 * The cytoscape stylesheet, built from the view preferences (viz/graphPrefs.js)
 * and, in icon mode, from the D3FEND icon set (viz/icons.js).
 *
 * Kept apart from graphPane.js so it can be asserted on without a browser or a
 * cytoscape instance: `buildStyle` is a pure function of its two arguments.
 */

import { iconDataUri, resolveIconName } from './icons.js';
import {
  CONTAINER_INSET,
  CONTAINER_LABEL_MAX_WIDTH,
  containerIconSize,
  containerLabelBand,
  containerLabelOffsetX,
} from './graphPrefs.js';

/**
 * Node category → colour. The single source for both the plain node fill and the
 * icon tint, so the two rendering modes read as the same taxonomy.
 *
 * The first four are D3FENDCore branches. The rest are the DPV families that have no
 * D3FEND counterpart (`coreCategoryOf` in rdf/graphModel.js folds DPV's Entity and
 * Data onto Agent and Artifact instead of giving them a second colour). They are
 * deliberately a cooler, lower-chroma set than the D3FEND four: a legal concept is
 * context around the architecture, not another component of it.
 */
export const CATEGORY_COLORS = {
  Agent: '#e8590c',
  Artifact: '#4c6ef5',
  Plan: '#2f9e44',
  Goal: '#ae3ec9',
  Measure: '#0c8599',
  LegalBasis: '#5f3dc4',
  Purpose: '#9c6644',
  Process: '#495057',
};

const DEFAULT_CATEGORY_COLOR = '#868e96';

/**
 * An offensive technique, drawn red whatever branch it belongs to. D3FEND puts an
 * ATT&CK technique under the same `Plan` branch as a countermeasure, so by branch
 * alone an attack and the defence against it are the same green — and in a threat
 * model that is the one distinction the reader looks for first.
 *
 * Red only marks the adversary's side; it is not an error colour here, and no
 * other node style uses it.
 */
const OFFENSIVE_COLOR = '#e03131';

/**
 * Colour of a tactical-verb link (`d3f:hardens`, `d3f:detects`, … — the bucket
 * `rdf/linkKind.js` classifies). Deliberately the same green as the Plan branch:
 * these are the predicates a countermeasure acts *through*, so the edge reads as
 * belonging with the plan it comes from, apart from the grey every other kind keeps.
 */
const TACTICAL_VERB_COLOR = CATEGORY_COLORS.Plan;

/**
 * The one colour selection is said in, for both kinds of element. Nodes and edges
 * express it differently — a border, a halo — but a user should not have to learn
 * that twice, so at least the colour is shared.
 */
const SELECTION_COLOR = '#1c7ed6';
const PATH_FOCUS_NODE_COLOR = '#0b7285';
const PATH_FOCUS_EDGE_COLOR = '#0c8599';

/**
 * How far a folded node's ghost copy sits behind it. Small on purpose: cytoscape
 * folds the offset into the node's bounding box, so it is width the layout and
 * `fit` have to give away.
 */
const FOLD_GHOST_OFFSET = 4;

export const categoryColor = (coreCategory) => CATEGORY_COLORS[coreCategory] ?? DEFAULT_CATEGORY_COLOR;

/**
 * The colour of one node: its branch colour, unless it is an offensive technique.
 * Every place a node says its colour — the fill, the icon tint, the icon chip's
 * border, a folded ghost — goes through this, so an attack is red in all of them.
 */
export const nodeColor = (element) =>
  element.data('offensive') ? OFFENSIVE_COLOR : categoryColor(element.data('coreCategory'));

/** The icon URI for an element, or undefined when its type resolves to none. */
function iconFor(iconSet, element) {
  const name = resolveIconName(iconSet, element.data('typeName'));
  return name && iconDataUri(iconSet, name, nodeColor(element));
}

/**
 * `iconSet` may be null (not yet fetched, or unreachable): every icon-mode rule
 * then resolves to no image, and the nodes stay coloured — the same fallback a
 * node whose class has no icon gets.
 */
export function buildStyle(prefs, iconSet = null) {
  const iconMode = prefs.nodeStyle === 'icon';
  const containerIcon = containerIconSize(prefs);
  const containerBand = containerLabelBand(prefs);

  const style = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'background-color': (ele) => nodeColor(ele),
        color: '#212529',
        width: prefs.nodeSize,
        height: prefs.nodeSize,
        'font-size': prefs.fontSize,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-wrap': 'wrap',
        'text-max-width': '120',
      },
    },
  ];

  if (iconMode) {
    // A tinted glyph on a white chip outlined in the category colour, so the
    // taxonomy still reads at a glance without the solid fill.
    style.push({
      selector: 'node[typeName]',
      style: {
        shape: 'round-rectangle',
        'background-image': (ele) => iconFor(iconSet, ele) ?? 'none',
        // `contain` keeps the glyph inside the node at every zoom level, as long
        // as the SVG itself declares an intrinsic size (see icons.js).
        'background-fit': 'contain',
        'background-image-containment': 'inside',
        'background-clip': 'node',
        'background-color': (ele) => (iconFor(iconSet, ele) ? '#fff' : nodeColor(ele)),
        'border-width': (ele) => (iconFor(iconSet, ele) ? 1 : 0),
        'border-color': (ele) => nodeColor(ele),
      },
    });
  }

  // The label goes *inside* the box, in the gutter `padding` reserves for it.
  //
  // `top-inside`/`left-inside` are not cosmetic variants of `top`/`left`: the
  // plain ones anchor the label at `y1 - padding` / `x1 - padding` and lay its box
  // out away from the node, so a container's label — 200px wide, opaque, bordered —
  // was painted above and to the left of the container, over whatever was there.
  // Nothing accounts for a parent's own label (cytoscape derives a compound's box
  // from its children; ELK is never told the parent's size at all), so that
  // overlap could not be laid out around — it had to stop happening.
  //
  // The margins are then what is left of the label's offsets once that anchor has
  // been walked back to the container's border — *two* paddings, not one. The
  // renderer measures the anchor from `node.width()/height()`, which for a compound
  // is the children's bounding box, while the box it draws is that plus a padding on
  // each side: so `left-inside` lands a padding inside the children, right next to
  // the first one, and only `2 × padding` back is the border itself.
  //
  // The label therefore starts at (containerLabelOffsetX, CONTAINER_INSET) from the
  // container's top-left corner.
  const fromOuterEdge = (offset) => offset - 2 * containerBand;

  style.push({
    selector: 'node[isContainer]',
    style: {
      shape: 'roundrectangle',
      'background-opacity': 0.15,
      'border-width': 2,
      'border-color': '#495057',
      'text-valign': 'top-inside',
      'text-halign': 'left-inside',
      'text-margin-x': fromOuterEdge(containerLabelOffsetX(prefs)),
      'text-margin-y': fromOuterEdge(CONTAINER_INSET),
      // Wrapped, not ellipsized: a container's label is the id, the label and the
      // class on three lines, and cytoscape's `text-wrap: ellipsis` measures the
      // whole thing as one line and truncates it to one. (There is no
      // `text-overflow` property — the one that used to be set here was ignored.)
      'text-wrap': 'wrap',
      'text-max-width': CONTAINER_LABEL_MAX_WIDTH,
      'text-background-color': '#f8f9fa',
      'text-background-opacity': 1,
      'text-background-padding': 4,
      'text-background-shape': 'rectangle',
      'text-border-color': '#495057',
      'text-border-width': 1,
      'text-border-opacity': 1,
      'text-border-style': 'solid',
      // A single number, not a CSS-style shorthand: cytoscape's `padding` is one
      // `sizeMaybePercent`, so `'42px 20px 20px 20px'` failed to parse and the
      // property silently fell back to its default of 0 — containers hugged their
      // children exactly, the band the label sits in was never rendered, and every
      // gap ELK had reserved for it was given away.
      padding: containerBand,
    },
  });

  if (iconMode && containerIcon) {
    // A container's box is its children's bounding box, so `contain` would blow
    // the icon up to fill it: it is pinned at a fixed size in the top-left
    // corner instead, immediately left of the label.
    //
    // Every length carries an explicit `px`: cytoscape reads a bare
    // `background-position-*` as a *percentage* of the node, which would have
    // moved the icon with the container's size instead of pinning it.
    style.push({
      selector: 'node[isContainer][typeName]',
      style: {
        'background-image': (ele) => iconFor(iconSet, ele) ?? 'none',
        'background-fit': 'none',
        'background-width': `${containerIcon}px`,
        'background-height': `${containerIcon}px`,
        'background-position-x': `${CONTAINER_INSET}px`,
        'background-position-y': `${CONTAINER_INSET}px`,
        'background-offset-x': 0,
        'background-offset-y': 0,
        'background-image-opacity': 1,
        'background-clip': 'none',
      },
    });
  }

  // A folded container stands for a whole subtree, and is drawn as a stack of
  // things rather than one: `ghost` puts an offset translucent copy of the node
  // behind it, and the clipped corners give it a silhouette that neither node
  // style's leaf has — an ellipse in colour mode, a round-rectangle in icon mode.
  //
  // It keeps its category colour and its D3FEND icon (the leaf rule's, which this
  // one deliberately does not override), since the node's class is still true of
  // it. How much it hides is on its label, from toCytoscape.js.
  //
  // Pushed after the container rules, as cytoscape takes each property from the
  // last rule that sets it.
  style.push({
    selector: 'node[folded]',
    style: {
      shape: 'cut-rectangle',
      width: Math.round(prefs.nodeSize * 1.4),
      height: Math.round(prefs.nodeSize * 1.4),
      ghost: 'yes',
      'ghost-offset-x': FOLD_GHOST_OFFSET,
      'ghost-offset-y': FOLD_GHOST_OFFSET,
      'ghost-opacity': 0.35,
      'border-width': 1,
      'border-color': (ele) => nodeColor(ele),
      'border-opacity': 1,
    },
  });

  // While directional flow focus is active, non-matching nodes are dimmed rather
  // than hidden so the graph stays legible as context.
  style.push({
    selector: 'node.path-focus-dim',
    style: {
      opacity: 0.45,
      'text-opacity': 0.6,
    },
  });

  style.push({
    selector: 'node.path-focus-node',
    style: {
      opacity: 1,
      'text-opacity': 1,
      'border-color': PATH_FOCUS_NODE_COLOR,
      'border-width': 2,
      'border-opacity': 1,
    },
  });

  // Selection, last of the node rules so it wins.
  //
  // Cytoscape keeps its own default stylesheet and appends ours, and its default
  // `:selected` rule only sets `background-color` — which our unconditional `node`
  // rule overrides, so selecting a node used to change nothing at all on screen.
  // This says it with the border instead, leaving `background-color` alone so the
  // category colour and the D3FEND icon survive being selected.
  style.push({
    selector: 'node:selected',
    style: {
      // Thin on purpose: the colour carries the message, and a heavy ring on a
      // small leaf swallows the node it is marking.
      'border-width': 2,
      'border-color': SELECTION_COLOR,
      'border-opacity': 1,
    },
  });

  style.push({
    selector: 'edge',
    style: {
      // Dropping the mapping rather than blanking it: cytoscape then skips the
      // label pass entirely, which is what makes a dense graph readable.
      ...(prefs.edgeLabels ? { label: 'data(label)' } : {}),
      color: '#212529',
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      width: 1.5,
      'font-size': Math.max(6, prefs.fontSize - 2),
      'line-color': '#adb5bd',
      'target-arrow-color': '#adb5bd',
      // Set unconditionally, so that the rules below only ever have to say
      // *whether* there is a head at the source end, never what colour it is.
      'source-arrow-color': '#adb5bd',
      'text-rotation': 'autorotate',
      'text-background-color': '#f8f9fa',
      'text-background-opacity': 1,
      'text-background-padding': '2',
    },
  });

  // A relation asserted both ways between the same pair is one link with a head at
  // each end (viz/toCytoscape.js), not two arrows facing each other. Only the shape
  // is set here: the colour is the base rule's, so a two-way link of any kind is
  // coloured by the kind rules below exactly as a one-way one is.
  style.push({
    selector: 'edge[bidirectional]',
    style: {
      'source-arrow-shape': 'triangle',
    },
  });

  // The link kind rides on every edge from toCytoscape.js, so a tactical verb is
  // recognisable without reading its label — which the edge-label preference may
  // well have turned off. Only this kind is coloured: the point is to tell the
  // defensive action apart from the flows and the topology, not to paint five
  // buckets nobody can hold in their head.
  style.push({
    selector: 'edge[kind="tactical-verb"]',
    style: {
      'line-color': TACTICAL_VERB_COLOR,
      'target-arrow-color': TACTICAL_VERB_COLOR,
      'source-arrow-color': TACTICAL_VERB_COLOR,
    },
  });

  // A link inherited from inside a folded container is not a triple in the store,
  // and says so: dashed, and weighted by how many child links collapsed onto it.
  // Colour, arrow and predicate are left alone — the link's kind and direction are
  // still literally true of it, so they must read exactly as an asserted link's do.
  style.push({
    selector: 'edge[derived]',
    style: {
      'line-style': 'dashed',
      width: (ele) => derivedEdgeWidth(ele.data('foldedCount')),
    },
  });

  // A collapsed artifact path is not a triple in the store either, but it is not the
  // same non-triple a fold is: it stands for two links with two predicates rather
  // than for several links sharing one. Dotted where a fold is dashed, and after the
  // rule above so it wins the `line-style` both set. Colour and arrow are left alone
  // for the same reason: the direction it draws is the direction the data moves.
  style.push({
    selector: 'edge[collapsed]',
    style: {
      'line-style': 'dotted',
    },
  });

  style.push({
    selector: 'edge.path-focus-dim',
    style: {
      opacity: 0.15,
      'text-opacity': 0.2,
    },
  });

  style.push({
    selector: 'edge.path-focus-edge',
    style: {
      opacity: 1,
      'text-opacity': 1,
      'overlay-color': PATH_FOCUS_EDGE_COLOR,
      'overlay-opacity': 0.25,
      'overlay-padding': 3,
    },
  });

  // Selection, last of the edge rules so it wins — same reason as the node one.
  //
  // Said with an overlay (a translucent halo drawn behind the line) rather than by
  // recolouring it, which is the edge's version of the node keeping its background:
  // here three properties are already spoken for, and all three have to survive
  // being selected. `line-color` carries the link kind (tactical-verb green, ADR 7),
  // `line-style` says the link is derived from a fold, and `width` says how many
  // child links it stands for (ADR 12).
  style.push({
    selector: 'edge:selected',
    style: {
      'overlay-color': SELECTION_COLOR,
      'overlay-opacity': 0.25,
      // Wider than the line by enough to read as a halo around a 1.5px edge
      // without swallowing the neighbours of a dense one.
      'overlay-padding': 4,
    },
  });

  return style;
}

/**
 * Width of a derived edge: heavier the more child links it stands for, capped so
 * that folding a densely connected container draws an edge, not a slab.
 */
export function derivedEdgeWidth(foldedCount) {
  return 1.5 + Math.min(3, Math.max(0, (foldedCount ?? 1) - 1)) * 0.75;
}
