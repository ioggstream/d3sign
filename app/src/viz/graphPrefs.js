/**
 * The View popover's preferences: how nodes are drawn, how much room the layout
 * gives them, how large the info panel's text is, and how large the editors'.
 *
 * Most of them are the D3FEND Graph pane's, which is why the store lives here and
 * the chip sits in that pane's header; `editorFontSize` is the outlier, kept in
 * the same object because one popover, one storage key and one reset button are
 * what the user sees.
 *
 * These are view state, like the filters and the graph visibility set: they are
 * persisted in localStorage and never reach the RDF store. Ranges live here so
 * the panel's sliders and the loader's clamping cannot drift apart.
 */

const STORAGE_KEY = 'd3fend-graph:view-prefs';

/** `[min, max]` per numeric preference; the panel renders its sliders from this. */
export const PREF_RANGES = {
  nodeSpacing: [20, 200],
  nodeSize: [12, 72],
  fontSize: [6, 20],
  containerPadding: [0, 60],
  panelFontSize: [9, 24],
  editorFontSize: [9, 24],
};

/** A string rather than a boolean, so a third mode stays cheap to add. */
export const NODE_STYLES = ['color', 'icon'];

/**
 * How much of a node's identity is drawn on it: the whole stack, or only the name
 * it goes by. A string for the same reason as `NODE_STYLES` — "the id alone" is an
 * obvious third mode.
 */
export const LABEL_DETAILS = ['full', 'name'];

export const DEFAULT_PREFS = {
  nodeStyle: 'color',
  // Defaults to the whole stack — id, rdfs:label, rdf:type — because that is what
  // the drawing has always said. `name` draws the label alone and moves the id and
  // the type to the hover tooltip.
  labelDetail: 'full',
  nodeSpacing: 60,
  nodeSize: 30,
  fontSize: 10,
  // Extra room inside a container, *added* to what its own label needs rather
  // than replacing it: at 0 a container is as tight as its label allows, which is
  // the rendering to compare any complaint against.
  containerPadding: 0,
  // The info panel's text, which is HTML rather than a cytoscape label and so has
  // nothing to do with `fontSize`: the panel has to stay readable at a font size
  // that would crowd the drawing. 13px is the previous fixed --fs-md.
  panelFontSize: 13,
  // The three CodeMirror panes, which used to disagree: the source editor took the
  // 16px document default and the TriG and SPARQL panes a fixed --fs-sm (12px).
  // One size for all three, between the two.
  editorFontSize: 13,
  edgeLabels: true,
  // The one preference that changes *which* elements exist rather than how they
  // are drawn, so it defaults off: a diagram must first be seen as the TriG
  // describes it (docs/adr/0026-collapse-artifact-mediated-paths.md).
  collapseArtifactPaths: false,
};

function clamp(value, [min, max], fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Normalizes anything — saved JSON, a slider's string value — into a full prefs object. */
export function normalizePrefs(prefs) {
  const merged = { ...DEFAULT_PREFS, ...(prefs ?? {}) };
  for (const [key, range] of Object.entries(PREF_RANGES)) {
    merged[key] = clamp(merged[key], range, DEFAULT_PREFS[key]);
  }
  if (!NODE_STYLES.includes(merged.nodeStyle)) merged.nodeStyle = DEFAULT_PREFS.nodeStyle;
  if (!LABEL_DETAILS.includes(merged.labelDetail)) merged.labelDetail = DEFAULT_PREFS.labelDetail;
  merged.edgeLabels = Boolean(merged.edgeLabels);
  // A payload written before this key existed loads as false, which is also the
  // default — so unlike the filters, where an absent entry means "hidden", there is
  // no vocabulary to record.
  merged.collapseArtifactPaths = Boolean(merged.collapseArtifactPaths);
  return merged;
}

/** Saved preferences over the defaults; corrupt or absent storage yields the defaults. */
export function loadPrefs() {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePrefs(prefs)));
}

/*
 * Container geometry. A compound node draws its label in a band across its top,
 * with the icon (when icons are on) to the label's left. Two consumers need the
 * same number per container and must not drift apart:
 *   - graphStyle.js, to set the container's `padding` and place the label inside it;
 *   - layouts.js, whose ELK padding has to reserve the same gutter so children —
 *     and neighbours — are not laid out inside the box cytoscape draws.
 *
 * The band used to *be* the container's cytoscape `padding`, which meant paying
 * for a three-line label on the left, the right and the bottom as well. Cytoscape
 * cannot be asked for a taller top: in 3.34 `padding-left/right/top/bottom` are
 * declared as aliases `pointsTo: 'padding'` (style/properties.mjs), `padding`
 * resolves once per node into the scalar `_p.autoPadding`
 * (collection/dimensions/bounds.mjs) and the renderer draws `width + 2 * padding`
 * by `height + 2 * padding` centred on the node (renderer/canvas/drawing-nodes.mjs).
 * `bounds-expansion` does take four per-side values, but they only reach
 * `boundingBox()`, `cy.fit()` and render culling — never the painted rectangle.
 *
 * So the two are now separate numbers with separate mechanisms:
 *
 *   - the *side gutter* is the cytoscape `padding`, small and the same on all four
 *     sides, and it is what the preference adds to;
 *   - the *label band* is extra node height placed entirely above the children,
 *     via `min-height` with `min-height-bias-top: 100%`. `updateCompoundBounds`
 *     sets `autoHeight = max(childrenHeight, min-height)` and biases the surplus
 *     with `pos.y = (-diffTop + bb.y1 + bb.y2 + diffBottom) / 2`, so a 100% top
 *     bias puts all of it above the children and none below.
 *
 * The band therefore cannot be a style mapper: it depends on the children's
 * measured height, and a mapper is evaluated when the stylesheet is applied and
 * cached, so it would freeze at whatever the geometry was then. graphPane.js
 * maintains it as a per-container `min-height` bypass instead — see
 * `applyContainerBands` there, which is the one piece of view state that is not a
 * pure function of the preferences.
 *
 * A container's drawn gutter is therefore `band + sideGutter` on top and
 * `sideGutter` on the other three sides. layouts.js gives ELK exactly those four
 * numbers: whatever the two disagree on is how far a neighbour can end up inside
 * a container.
 */

/** Gap between the container's top-left corner and whatever it draws there. */
export const CONTAINER_INSET = 8;

/**
 * The text actually drawn on a node, from the parts viz/toCytoscape.js emits.
 *
 * In `full` mode it is the stacked id / rdfs:label / rdf:type the drawing has
 * always shown. In `name` mode it is the name the node goes by — its `rdfs:label`,
 * or its id when it has none — and the rest moves to the hover tooltip. The fold
 * marker stays in both: it reports what the *drawing* is hiding rather than what
 * the RDF says, and it is the only place a fold's size is shown
 * (docs/adr/0012-fold-container-nodes.md).
 *
 * The single source for three callers that have to agree: the `label` property in
 * graphStyle.js, the container band in graphPane.js, and ELK's reserved padding in
 * layouts.js. Sizing a container's band from different text than the style draws
 * would leave its box and the room reserved around it disagreeing.
 */
export function drawnLabel(data, prefs) {
  if (prefs.labelDetail !== 'name') return data.label ?? '';
  return [data.name || data.displayId, data.foldNote].filter(Boolean).join('\n');
}

/** Past this many characters a predicate name is broken at its hyphens. */
const EDGE_LABEL_WRAP_CHARS = 10;

/**
 * The text drawn on a link, which in `name` mode is the predicate's local name
 * rather than its CURIE.
 *
 * Only `d3f:` is dropped. Every other prefix is doing work — a `dpv:` and a `d3f:`
 * term can share a local name, and in a diagram mixing the two the prefix is the
 * only thing telling them apart. D3FEND is the vocabulary this editor is for, so
 * its prefix is the one that says nothing.
 *
 * A long name is then broken at its hyphens, because a link label is drawn rotated
 * along the edge and `may-authenticate-with` laid end to end crosses half the
 * drawing. The break keeps the hyphen on the first line, the way hyphenation does.
 *
 * Like `drawnLabel`, this composes at draw time and leaves `data.label` alone: the
 * edge panel reads the drawn label to report what the link says
 * (`edgePanelSummary` in edgePanel.js) and `data.predicate` is what every action
 * acts on, so neither may see an abbreviation.
 */
export function drawnEdgeLabel(data, prefs) {
  const label = data.label ?? '';
  if (prefs.labelDetail !== 'name') return label;
  // The ×N of a folded group belongs to the fold, not to the predicate: set aside
  // so it is neither stripped of a prefix nor broken across lines.
  const counted = /^(.*?)( ×\d+)$/.exec(label);
  const head = counted ? counted[1] : label;
  const count = counted ? counted[2] : '';
  const bare = head.startsWith('d3f:') ? head.slice('d3f:'.length) : head;
  const wrapped = bare.length > EDGE_LABEL_WRAP_CHARS ? bare.replaceAll('-', '-\n') : bare;
  return wrapped + count;
}

/**
 * The gutter a container keeps on every side before the preference adds to it.
 * The label does not live here — it lives in the band above the children — so
 * this only has to stop a child from touching the border.
 */
export const CONTAINER_SIDE_MIN = 8;

/** Lines a container's label may be sized for, however long it really is. */
const MAX_LABEL_LINES = 3;

/** Maximum label width before it wraps, in pixels. */
export const CONTAINER_LABEL_MAX_WIDTH = 200;

/** Side of the container's icon, or 0 in colour mode. Slightly smaller than a leaf node. */
export function containerIconSize(prefs) {
  return prefs.nodeStyle === 'icon' ? Math.round(prefs.nodeSize * 0.8) : 0;
}

/** Where the container's label starts, leaving room for the icon on its left. */
export function containerLabelOffsetX(prefs) {
  const icon = containerIconSize(prefs);
  return CONTAINER_INSET + (icon ? icon + 6 : 16);
}

/**
 * Average glyph width as a fraction of the font size, for guessing how many
 * visual lines a label wraps onto. An approximation, and knowingly one: the real
 * answer needs the renderer's text metrics, which are not available here and
 * would make this module need a browser. It only has to be close enough that a
 * container's label does not land on its first child — `containerPadding` is the
 * knob for the cases where it is not.
 */
const GLYPH_WIDTH_RATIO = 0.6;

/**
 * How many lines a container's label actually occupies, counting the wrapping
 * cytoscape does at `CONTAINER_LABEL_MAX_WIDTH`.
 *
 * Reserving three lines for every container — which is what the band used to do —
 * was safe precisely because it covered both the longest label and any wrapping.
 * Sizing the band per container gives that slack back, so the wrap has to be
 * accounted for here rather than ignored.
 */
export function estimatedLabelLines(label, fontSize) {
  if (!label) return 1;
  const perLine = Math.max(1, Math.floor(CONTAINER_LABEL_MAX_WIDTH / (fontSize * GLYPH_WIDTH_RATIO)));
  let lines = 0;
  for (const line of String(label).split('\n')) {
    lines += Math.max(1, Math.ceil(line.length / perLine));
    if (lines >= MAX_LABEL_LINES) return MAX_LABEL_LINES;
  }
  return lines;
}

/**
 * The container's gutter on every side: small, and the only part the
 * `containerPadding` preference moves. The label is not in here.
 */
export function containerSideGutter(prefs) {
  return CONTAINER_SIDE_MIN + prefs.containerPadding;
}

/**
 * Height reserved above a container's children for its icon and label: the inset,
 * then the taller of the icon and a label of `lines` lines, then the inset again.
 * Cytoscape's line height is 1, so a line is exactly `fontSize` tall.
 *
 * This is *extra node height*, not padding — graphPane.js applies it as a
 * `min-height` bypass biased entirely to the top. It is deliberately not widened
 * by `containerPadding`: the side gutter that preference grows is added around
 * this by cytoscape's own padding, so the top would otherwise grow twice.
 */
export function containerLabelBandFor(prefs, lines) {
  const labelLines = Math.min(MAX_LABEL_LINES, Math.max(1, lines));
  return (
    CONTAINER_INSET + Math.max(containerIconSize(prefs), prefs.fontSize * labelLines) + CONTAINER_INSET
  );
}

/**
 * The widest band any container can need, for callers with no particular
 * container in hand — ELK's root-graph padding, and anything sizing against the
 * worst case.
 */
export function containerLabelBand(prefs) {
  return containerLabelBandFor(prefs, MAX_LABEL_LINES);
}
