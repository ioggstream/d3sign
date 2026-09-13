import { describe, it, expect } from 'vitest';
import {
  LAYOUTS,
  DEFAULT_LAYOUT_ID,
  elkPadding,
  labelAnchorTransform,
  layoutOptions,
  normalizeSteps,
  rotatePoint,
  supportsFlowRoot,
  supportsTierLayering,
} from '../src/viz/layouts.js';
import { DEFAULT_PREFS, containerLabelBand } from '../src/viz/graphPrefs.js';

describe('layoutOptions', () => {
  it('returns the options of the requested layout', () => {
    expect(layoutOptions('grid')).toMatchObject({ name: 'grid' });
    expect(layoutOptions('elk-mrtree')).toMatchObject({ name: 'elk', elk: { algorithm: 'mrtree' } });
  });

  it('falls back to the default for an unknown id', () => {
    // Compared field by field: the function-valued options are fresh closures per
    // call, so the objects are never reference-equal.
    expect(layoutOptions('nope').elk).toEqual(layoutOptions(DEFAULT_LAYOUT_ID).elk);
    expect(layoutOptions('nope').name).toBe(layoutOptions(DEFAULT_LAYOUT_ID).name);
  });

  it('lists unique ids and labels', () => {
    expect(new Set(LAYOUTS.map((l) => l.id)).size).toBe(LAYOUTS.length);
    expect(new Set(LAYOUTS.map((l) => l.label)).size).toBe(LAYOUTS.length);
  });

  it('corrects every layout for where it anchors a node against its label', () => {
    for (const layout of LAYOUTS) {
      expect(layoutOptions(layout.id).transform).toBe(labelAnchorTransform);
    }
  });
});

describe('tier layering', () => {
  const tiers = new Map([
    ['user', 0],
    ['db', 3],
  ]);
  // `data()` is read for a container's label, which decides how tall its band is.
  const node = (id, isParent = false) => ({
    id: () => id,
    isParent: () => isParent,
    data: () => ({ id, label: id }),
  });

  it('states a node’s tier as its ELK partition', () => {
    const options = layoutOptions('elk-layered', DEFAULT_PREFS, { tiers });
    expect(options.nodeLayoutOptions(node('user'))).toEqual({ 'elk.partitioning.partition': 0 });
    expect(options.nodeLayoutOptions(node('db'))).toEqual({ 'elk.partitioning.partition': 3 });
    // A node the walk did not place says nothing, rather than claiming tier 0.
    expect(options.nodeLayoutOptions(node('unknown'))).toBeUndefined();
  });

  it('partitions a container too, keeping its padding', () => {
    // An unpartitioned node in a partitioned graph moves its neighbours out of their
    // tiers (app/test/elk-partitioning.test.js).
    const withBox = new Map([...tiers, ['box', 1]]);
    const options = layoutOptions('elk-layered', DEFAULT_PREFS, { tiers: withBox });
    const box = options.nodeLayoutOptions(node('box', true));
    expect(box['elk.partitioning.partition']).toBe(1);
    // The padding is the container's own, sized from its label; the tier is added to it
    // rather than replacing it.
    expect(box['elk.padding']).toMatch(/^\[top=\d+,left=\d+,bottom=\d+,right=\d+\]$/);
  });

  it('keeps the flow root’s layer constraint alongside its partition', () => {
    const options = layoutOptions('elk-layered', DEFAULT_PREFS, { tiers, rootId: 'user' });
    expect(options.nodeLayoutOptions(node('user'))).toEqual({
      'elk.layered.layering.layerConstraint': 'FIRST',
      'elk.partitioning.partition': 0,
    });
  });

  it('turns partitioning on, and component separation off with it', () => {
    // Holding the non-flow links back leaves a standby replica in a component of its own,
    // and `layered` splits components before partitioning runs.
    const elk = layoutOptions('elk-layered', DEFAULT_PREFS, { tiers }).elk;
    expect(elk['elk.partitioning.activate']).toBe(true);
    expect(elk['elk.separateConnectedComponents']).toBe(false);
  });

  it('changes nothing at all when no tier was computed', () => {
    // The regression guard for every other drawing: an empty map is not a tiering.
    const plain = layoutOptions('elk-layered', DEFAULT_PREFS).elk;
    expect(layoutOptions('elk-layered', DEFAULT_PREFS, { tiers: new Map() }).elk).toEqual(plain);
    expect('elk.partitioning.activate' in plain).toBe(false);
    expect('elk.separateConnectedComponents' in plain).toBe(false);
  });

  it('is offered by the layered layout alone', () => {
    expect(LAYOUTS.filter((l) => supportsTierLayering(l.id)).map((l) => l.id)).toEqual([
      'elk-layered',
    ]);
  });
});

describe('starting the reading from a node', () => {
  it('hands breadth-first its roots, and leaves the option off without them', () => {
    expect(layoutOptions('breadthfirst', DEFAULT_PREFS, { roots: ['user'] }).roots).toEqual([
      'user',
    ]);
    // Absent rather than empty: cytoscape reads an empty list as "no roots at all",
    // where absence means "choose them yourself".
    expect('roots' in layoutOptions('breadthfirst', DEFAULT_PREFS)).toBe(false);
    expect('roots' in layoutOptions('breadthfirst', DEFAULT_PREFS, { roots: null })).toBe(false);
  });

  it('is offered by the two layouts that can honour it', () => {
    expect(LAYOUTS.filter((l) => supportsFlowRoot(l.id)).map((l) => l.id)).toEqual([
      'elk-layered',
      'breadthfirst',
    ]);
  });
});

describe('layoutOptions honours the spacing preference', () => {
  const wide = { ...DEFAULT_PREFS, nodeSpacing: 120 };

  it('feeds ELK its explicit gaps', () => {
    const options = layoutOptions('elk-layered', wide);
    expect(options.elk['elk.spacing.nodeNode']).toBe(120);
    expect(options.elk['elk.spacing.edgeNode']).toBe(40);
    expect(options.elk['elk.layered.spacing.nodeNodeBetweenLayers']).toBe(160);
    // What keeps an unrelated node clear of a container it shares no edge with,
    // since `layered` lays out connected components separately.
    expect(options.elk['elk.spacing.componentComponent']).toBe(120);
  });

  it('reserves the container label band on every side, as cytoscape draws it', () => {
    const band = containerLabelBand(wide);
    // Uniform, because cytoscape's compound `padding` is a single value: any side
    // where ELK reserves less is a side a neighbour can be laid out inside.
    expect(layoutOptions('elk-mrtree', wide).elk['elk.padding'])
      .toBe(`[top=${band},left=${band},bottom=${band},right=${band}]`);
  });

  it('repeats the padding on every container, which ELK does not inherit', () => {
    const options = layoutOptions('elk-layered', wide);
    const parent = { isParent: () => true };
    const leaf = { isParent: () => false };
    expect(options.nodeLayoutOptions(parent)).toEqual({ 'elk.padding': elkPadding(wide) });
    expect(options.nodeLayoutOptions(leaf)).toBeUndefined();
  });

  it('grows the padding when icons make the container label band taller', () => {
    const icons = { ...DEFAULT_PREFS, nodeStyle: 'icon', nodeSize: 72 };
    expect(containerLabelBand(icons)).toBeGreaterThan(containerLabelBand(DEFAULT_PREFS));
    expect(elkPadding(icons)).not.toBe(elkPadding(DEFAULT_PREFS));
  });

  it("scales cytoscape's own layouts by a multiplier", () => {
    expect(layoutOptions('grid', wide).spacingFactor).toBe(2);
    expect(layoutOptions('grid', DEFAULT_PREFS).spacingFactor).toBe(1);
    expect(layoutOptions('cose', wide).idealEdgeLength).toBe(120);
  });

  it('every layout answers the spacing slider', () => {
    for (const layout of LAYOUTS) {
      const tight = JSON.stringify(layoutOptions(layout.id, { ...DEFAULT_PREFS, nodeSpacing: 20 }));
      expect(tight).not.toBe(JSON.stringify(layoutOptions(layout.id, wide)));
    }
  });
});

describe('labelAnchorTransform', () => {
  /** A node whose box is `reserved` tall, of which `body` is the node itself. */
  const node = (body, reserved) => ({
    outerHeight: () => body,
    layoutDimensions: () => ({ w: 120, h: reserved }),
  });

  it('lifts a node by half of the label hanging below it', () => {
    // A layout hands back the centre of the 60px it reserved, but 30px of that is
    // label drawn under the node — so the node itself belongs 15px higher.
    expect(labelAnchorTransform(node(30, 60), { x: 100, y: 200 })).toEqual({ x: 100, y: 185 });
  });

  it('leaves a node whose box is all node where the layout put it', () => {
    expect(labelAnchorTransform(node(30, 30), { x: 5, y: 7 })).toEqual({ x: 5, y: 7 });
  });
});

describe('normalizeSteps', () => {
  it('wraps into 0..3, including negative turns', () => {
    expect([-5, -1, 0, 3, 4, 7].map(normalizeSteps)).toEqual([3, 3, 0, 3, 0, 3]);
  });
});

describe('rotatePoint', () => {
  const center = { x: 0, y: 0 };

  it('maps right to below the centre for one clockwise turn (screen y grows down)', () => {
    expect(rotatePoint({ x: 10, y: 0 }, center, 1)).toEqual({ x: 0, y: 10 });
  });

  it('maps right to above the centre for one counter-clockwise turn', () => {
    expect(rotatePoint({ x: 10, y: 0 }, center, -1)).toEqual({ x: 0, y: -10 });
  });

  it('mirrors through the centre after two turns', () => {
    expect(rotatePoint({ x: 3, y: 7 }, { x: 1, y: 1 }, 2)).toEqual({ x: -1, y: -5 });
  });

  it('is the identity after four turns', () => {
    expect(rotatePoint({ x: 3, y: 7 }, { x: 1, y: 1 }, 4)).toEqual({ x: 3, y: 7 });
  });
});
