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
  panelFontSize: [9, 24],
  editorFontSize: [9, 24],
};

/** A string rather than a boolean, so a third mode stays cheap to add. */
export const NODE_STYLES = ['color', 'icon'];

export const DEFAULT_PREFS = {
  nodeStyle: 'color',
  nodeSpacing: 60,
  nodeSize: 30,
  fontSize: 10,
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
 * with the icon (when icons are on) to the label's left. Three consumers need
 * the same numbers and must not drift apart:
 *   - graphStyle.js, to place the label and the background image;
 *   - graphPane.js, whose tap handler treats that band as the container's hit box;
 *   - layouts.js, whose ELK padding has to reserve the band so children are not
 *     laid out underneath it.
 *
 * The band is also the container's cytoscape `padding`, because cytoscape has no
 * per-side compound padding — `padding-left/right/top/bottom` are aliases of the
 * one `padding` property. So a container's gutter is the band on all four sides,
 * and ELK is given the same number on all four sides: whatever the two disagree
 * on is exactly how far a neighbour can end up inside a container.
 */

/** Gap between the container's top-left corner and whatever it draws there. */
export const CONTAINER_INSET = 8;

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
 * Height of the top band a container reserves for its icon and label: the inset,
 * then the taller of the icon and a three-line label, then the inset again.
 * Cytoscape's line height is 1, so a line is exactly `fontSize` tall.
 */
export function containerLabelBand(prefs) {
  return CONTAINER_INSET + Math.max(containerIconSize(prefs), prefs.fontSize * 3) + CONTAINER_INSET;
}
