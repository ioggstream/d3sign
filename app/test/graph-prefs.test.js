import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// The module reads localStorage at call time; the test runner is plain node, so
// stub it before importing (a static import would hoist above the assignment).
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};

let loadPrefs;
let savePrefs;
let normalizePrefs;
let DEFAULT_PREFS;
let PREF_RANGES;
let containerIconSize;
let containerLabelBand;
let containerLabelOffsetX;
let CONTAINER_INSET;

beforeAll(async () => {
  ({
    loadPrefs,
    savePrefs,
    normalizePrefs,
    DEFAULT_PREFS,
    PREF_RANGES,
    containerIconSize,
    containerLabelBand,
    containerLabelOffsetX,
    CONTAINER_INSET,
  } = await import('../src/viz/graphPrefs.js'));
});

beforeEach(() => stored.clear());

describe('view preferences', () => {
  it('defaults when nothing was saved', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('round-trips a saved change', () => {
    savePrefs({ ...DEFAULT_PREFS, nodeStyle: 'icon', nodeSize: 48, edgeLabels: false });
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, nodeStyle: 'icon', nodeSize: 48, edgeLabels: false });
  });

  it('leaves artifact-path collapsing off by default', () => {
    // It removes nodes the TriG asserts, so a diagram must first be seen as written
    // (docs/adr/0026-collapse-artifact-mediated-paths.md).
    expect(DEFAULT_PREFS.collapseArtifactPaths).toBe(false);
  });

  it('round-trips artifact-path collapsing, and loads a payload without the key as off', () => {
    savePrefs({ ...DEFAULT_PREFS, collapseArtifactPaths: true });
    expect(loadPrefs().collapseArtifactPaths).toBe(true);
    // Saved before the key existed: absent means off, which is also the default, so
    // unlike the filters there is no vocabulary to record.
    stored.set('d3fend-graph:view-prefs', JSON.stringify({ nodeStyle: 'icon' }));
    expect(loadPrefs().collapseArtifactPaths).toBe(false);
  });

  it('sizes the info panel independently of the graph labels', () => {
    // The panel is HTML, the labels are cytoscape text: a size that reads well in
    // the modal crowds the drawing, so the two are separate preferences.
    expect(DEFAULT_PREFS.panelFontSize).not.toBe(DEFAULT_PREFS.fontSize);
    savePrefs({ ...DEFAULT_PREFS, panelFontSize: 18 });
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, panelFontSize: 18 });
    const [min, max] = PREF_RANGES.panelFontSize;
    expect(normalizePrefs({ panelFontSize: max + 40 }).panelFontSize).toBe(max);
    expect(normalizePrefs({ panelFontSize: 0 }).panelFontSize).toBe(min);
    // Saved before the key existed.
    expect(normalizePrefs({ nodeStyle: 'icon' }).panelFontSize).toBe(DEFAULT_PREFS.panelFontSize);
  });

  it('sizes the editors, one preference for all three panes', () => {
    savePrefs({ ...DEFAULT_PREFS, editorFontSize: 18 });
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, editorFontSize: 18 });
    const [min, max] = PREF_RANGES.editorFontSize;
    expect(normalizePrefs({ editorFontSize: max + 40 }).editorFontSize).toBe(max);
    expect(normalizePrefs({ editorFontSize: 0 }).editorFontSize).toBe(min);
    // Saved before the key existed: the default, not the sizes the editors used to
    // be hard-coded to.
    expect(normalizePrefs({ nodeStyle: 'icon' }).editorFontSize).toBe(DEFAULT_PREFS.editorFontSize);
  });

  it('clamps out-of-range numbers into their slider range', () => {
    const [min, max] = PREF_RANGES.nodeSpacing;
    expect(normalizePrefs({ nodeSpacing: max + 500 }).nodeSpacing).toBe(max);
    expect(normalizePrefs({ nodeSpacing: -5 }).nodeSpacing).toBe(min);
  });

  it('falls back per-key on junk values', () => {
    expect(normalizePrefs({ nodeSize: 'wide', nodeStyle: 'sparkles' })).toEqual(DEFAULT_PREFS);
  });

  it('survives corrupt storage', () => {
    stored.set('d3fend-graph:view-prefs', '{not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('leaves the known keys valid when storage carries a stale one', () => {
    // Unknown keys ride through untouched — nothing reads them, so they are
    // inert — but they must not disturb the keys the stylesheet does read.
    const prefs = normalizePrefs({ theme: 'dark' });
    expect(prefs).toMatchObject(DEFAULT_PREFS);
  });
});

describe('container geometry', () => {
  it('has no icon and the historical 24px label inset in colour mode', () => {
    expect(containerIconSize(DEFAULT_PREFS)).toBe(0);
    expect(containerLabelOffsetX(DEFAULT_PREFS)).toBe(24);
  });

  it('pushes the label right of the icon in icon mode', () => {
    const icons = { ...DEFAULT_PREFS, nodeStyle: 'icon' };
    expect(containerLabelOffsetX(icons)).toBeGreaterThan(containerIconSize(icons));
  });

  it('reserves a band tall enough for the icon, inset on both sides', () => {
    // The band is also the container's cytoscape padding, so what does not fit in
    // it is drawn over the children.
    const icons = { ...DEFAULT_PREFS, nodeStyle: 'icon', nodeSize: 72 };
    expect(containerLabelBand(icons))
      .toBe(CONTAINER_INSET + containerIconSize(icons) + CONTAINER_INSET);
  });

  it('reserves a band tall enough for a three-line label in colour mode', () => {
    expect(containerLabelBand(DEFAULT_PREFS))
      .toBeGreaterThanOrEqual(CONTAINER_INSET + DEFAULT_PREFS.fontSize * 3 + CONTAINER_INSET);
  });
});
