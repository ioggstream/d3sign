import { describe, it, expect } from 'vitest';
import {
  CATEGORY_COLORS,
  buildStyle,
  categoryColor,
  derivedEdgeWidth,
  nodeColor,
} from '../src/viz/graphStyle.js';
import {
  CONTAINER_INSET,
  DEFAULT_PREFS,
  containerIconSize,
  containerLabelBand,
  containerLabelOffsetX,
} from '../src/viz/graphPrefs.js';
import { LINK_KINDS } from '../src/rdf/linkKind.js';

const ICON_SET = {
  width: 24,
  height: 24,
  icons: { DigitalArtifact: { body: '<path fill="currentColor" d="M6 2h7v5h5z"/>' } },
};

const ICON_PREFS = { ...DEFAULT_PREFS, nodeStyle: 'icon' };

/** Stands in for a cytoscape element: the style functions only ever read data. */
const element = (data) => ({ data: (key) => data[key] });

const ruleFor = (style, selector) => style.find((rule) => rule.selector === selector);
/** Strips the unit off a `px` length so the geometry can be compared numerically. */
const px = (value) => Number(String(value).replace('px', ''));
/** Resolves a style value the way cytoscape does — a mapper is called with the element. */
const resolve = (value, ele) => (typeof value === 'function' ? value(ele) : value);

describe('buildStyle in colour mode', () => {
  const style = buildStyle(DEFAULT_PREFS, ICON_SET);

  it('fills a node with its D3FENDCore branch colour', () => {
    const fill = ruleFor(style, 'node').style['background-color'];
    expect(resolve(fill, element({ coreCategory: 'Artifact' }))).toBe(CATEGORY_COLORS.Artifact);
    expect(resolve(fill, element({ coreCategory: undefined }))).toBe(categoryColor(undefined));
  });

  it('fills an offensive technique red, whatever branch it is on', () => {
    // An ATT&CK technique and the countermeasure against it are both on the Plan
    // branch, so the branch colour alone draws them the same green.
    const fill = ruleFor(style, 'node').style['background-color'];
    const attack = element({ coreCategory: 'Plan', offensive: true });
    expect(resolve(fill, attack)).toBe(nodeColor(attack));
    expect(resolve(fill, attack)).not.toBe(CATEGORY_COLORS.Plan);
    expect(resolve(fill, element({ coreCategory: 'Plan' }))).toBe(CATEGORY_COLORS.Plan);
  });

  it('draws no icon even when the set is loaded', () => {
    expect(ruleFor(style, 'node[typeName]')).toBeUndefined();
    expect(ruleFor(style, 'node[isContainer][typeName]')).toBeUndefined();
  });

  it('sizes nodes and labels from the preferences', () => {
    const node = ruleFor(style, 'node').style;
    expect(node.width).toBe(DEFAULT_PREFS.nodeSize);
    expect(node['font-size']).toBe(DEFAULT_PREFS.fontSize);
  });
});

describe('buildStyle in icon mode', () => {
  const style = buildStyle(ICON_PREFS, ICON_SET);
  const typed = ruleFor(style, 'node[typeName]').style;

  it('tints a resolved icon with the branch colour on a white chip', () => {
    const artifact = element({ typeName: 'File', coreCategory: 'Artifact' });
    const uri = resolve(typed['background-image'], artifact);
    expect(decodeURIComponent(uri)).toContain(`fill="${CATEGORY_COLORS.Artifact}"`);
    expect(resolve(typed['background-color'], artifact)).toBe('#fff');
    expect(resolve(typed['border-width'], artifact)).toBe(1);
  });

  it('tints an offensive technique red in icon mode too', () => {
    const attack = element({ typeName: 'File', coreCategory: 'Plan', offensive: true });
    expect(decodeURIComponent(resolve(typed['background-image'], attack))).toContain(
      `fill="${nodeColor(attack)}"`,
    );
    expect(resolve(typed['border-color'], attack)).toBe(nodeColor(attack));
    expect(nodeColor(attack)).not.toBe(CATEGORY_COLORS.Plan);
  });

  it('leaves a node whose class has no icon as a coloured dot', () => {
    const bare = element({ typeName: 'D3FENDCore', coreCategory: 'Agent' });
    expect(resolve(typed['background-image'], bare)).toBe('none');
    expect(resolve(typed['background-color'], bare)).toBe(CATEGORY_COLORS.Agent);
    expect(resolve(typed['border-width'], bare)).toBe(0);
  });

  it('pins a container icon at its top-left, left of the label', () => {
    const container = ruleFor(style, 'node[isContainer][typeName]').style;
    const label = ruleFor(style, 'node[isContainer]').style;
    expect(container['background-fit']).toBe('none');
    expect(px(container['background-width'])).toBe(containerIconSize(ICON_PREFS));
    // The margin is measured back from the `-inside` anchor, two paddings inside
    // the border, so it is the sum that has to clear the icon.
    expect(2 * label.padding + label['text-margin-x']).toBeGreaterThan(
      px(container['background-position-x']) + px(container['background-width']),
    );
  });

  it('gives every container background length an explicit unit', () => {
    // A bare number is a *percentage* of the node to cytoscape, which would let
    // the icon drift with the container's size instead of staying pinned.
    const container = ruleFor(style, 'node[isContainer][typeName]').style;
    for (const key of ['background-width', 'background-height', 'background-position-x', 'background-position-y']) {
      expect(container[key]).toMatch(/^\d+px$/);
    }
  });

  it('falls back to colours when the icon set never loaded', () => {
    const offline = buildStyle(ICON_PREFS, null).find((r) => r.selector === 'node[typeName]').style;
    const artifact = element({ typeName: 'File', coreCategory: 'Artifact' });
    expect(resolve(offline['background-image'], artifact)).toBe('none');
    expect(resolve(offline['background-color'], artifact)).toBe(CATEGORY_COLORS.Artifact);
  });
});

describe('a container node', () => {
  const container = (prefs) => ruleFor(buildStyle(prefs, ICON_SET), 'node[isContainer]').style;

  it('reserves the label band as a gutter cytoscape can parse', () => {
    // `padding` is one length, not a CSS-style shorthand: a four-value string is
    // rejected and silently leaves the default of 0, which draws no gutter at all.
    for (const prefs of [DEFAULT_PREFS, ICON_PREFS]) {
      expect(container(prefs).padding).toBe(containerLabelBand(prefs));
      expect(typeof container(prefs).padding).toBe('number');
    }
  });

  it('draws its label inside the box, not outside it', () => {
    // `top`/`left` anchor the label outside the node, over its neighbours; only the
    // `-inside` variants put it in the gutter above the children.
    expect(container(DEFAULT_PREFS)['text-valign']).toBe('top-inside');
    expect(container(DEFAULT_PREFS)['text-halign']).toBe('left-inside');
  });

  it('anchors the label at the border, not next to the first child', () => {
    for (const prefs of [DEFAULT_PREFS, ICON_PREFS]) {
      const style = container(prefs);
      // Two paddings, because the `-inside` anchor is measured from the children's
      // bounding box and the border is one padding outside that. One padding put
      // the label alongside the first child instead of under the border.
      expect(2 * style.padding + style['text-margin-x']).toBe(containerLabelOffsetX(prefs));
      expect(2 * style.padding + style['text-margin-y']).toBe(CONTAINER_INSET);
      expect(containerLabelBand(prefs)).toBe(style.padding);
    }
  });

  it('leaves room in the band for a three-line label', () => {
    // id, label and rdf:type, each a line of `fontSize` — cytoscape's line height
    // is 1 — plus the background box drawn around them. Any more than that and the
    // label starts covering the children.
    const style = container(DEFAULT_PREFS);
    const label = CONTAINER_INSET + DEFAULT_PREFS.fontSize * 3 + style['text-background-padding'];
    expect(label).toBeLessThanOrEqual(style.padding);
  });
});

describe('edge labels', () => {
  it('maps the label when they are on', () => {
    expect(ruleFor(buildStyle(DEFAULT_PREFS), 'edge').style.label).toBe('data(label)');
  });

  it('drops the mapping entirely when they are off', () => {
    const edge = ruleFor(buildStyle({ ...DEFAULT_PREFS, edgeLabels: false }), 'edge').style;
    expect('label' in edge).toBe(false);
  });
});

describe('a folded container', () => {
  const style = buildStyle(DEFAULT_PREFS, ICON_SET);
  const folded = ruleFor(style, 'node[folded]').style;

  it('reads as a stack: an offset ghost copy behind a larger node', () => {
    expect(folded.ghost).toBe('yes');
    expect(folded['ghost-offset-x']).toBeGreaterThan(0);
    expect(folded['ghost-offset-y']).toBe(folded['ghost-offset-x']);
    // Translucent, or it would just look like a second node.
    expect(folded['ghost-opacity']).toBeGreaterThan(0);
    expect(folded['ghost-opacity']).toBeLessThan(1);
    expect(folded.width).toBeGreaterThan(DEFAULT_PREFS.nodeSize);
    expect(folded.width).toBe(folded.height);
  });

  it('takes a silhouette neither node style gives a leaf', () => {
    expect(folded.shape).toBe('cut-rectangle');
    // The base rule leaves leaves as ellipses; icon mode makes them round.
    expect(ruleFor(style, 'node').style.shape).toBeUndefined();
    expect(ruleFor(buildStyle(ICON_PREFS, ICON_SET), 'node[typeName]').style.shape).toBe('round-rectangle');
  });

  it('no longer leans on a double border, which read as a selection', () => {
    expect(folded['border-style']).toBeUndefined();
  });

  it('keeps its branch colour, since its class is still true of it', () => {
    expect(resolve(folded['border-color'], element({ coreCategory: 'Agent' }))).toBe(CATEGORY_COLORS.Agent);
  });

  it('is not styled as a compound, so it loses the label band', () => {
    // toCytoscape.js drops isContainer on a folded node; nothing here may put the
    // container's top-left label alignment back.
    expect('text-valign' in folded).toBe(false);
    expect('padding' in folded).toBe(false);
  });

  it('keeps the leaf icon rule in icon mode, rather than a folder glyph', () => {
    const iconStyle = buildStyle(ICON_PREFS, ICON_SET);
    const leaf = ruleFor(iconStyle, 'node[typeName]').style;
    const artifact = element({ typeName: 'File', coreCategory: 'Artifact', folded: true });
    expect(resolve(leaf['background-image'], artifact)).toBeTruthy();
    expect('background-image' in ruleFor(iconStyle, 'node[folded]').style).toBe(false);
  });
});

describe('tactical-verb edges', () => {
  const style = buildStyle(DEFAULT_PREFS);
  const tactical = ruleFor(style, 'edge[kind="tactical-verb"]').style;

  it('draws them green, arrowhead included', () => {
    expect(tactical['line-color']).toBe(CATEGORY_COLORS.Plan);
    expect(tactical['target-arrow-color']).toBe(CATEGORY_COLORS.Plan);
    // Both heads, so a two-way tactical link is not green with a grey tail.
    expect(tactical['source-arrow-color']).toBe(CATEGORY_COLORS.Plan);
  });

  it('leaves every other kind on the base edge colour', () => {
    const base = ruleFor(style, 'edge').style;
    expect(base['line-color']).not.toBe(CATEGORY_COLORS.Plan);
    for (const kind of LINK_KINDS.filter((k) => k !== 'tactical-verb')) {
      expect(ruleFor(style, `edge[kind="${kind}"]`)).toBeUndefined();
    }
  });

  it('is stated after the base edge rule, which cytoscape needs to let it win', () => {
    expect(style.indexOf(ruleFor(style, 'edge[kind="tactical-verb"]'))).toBeGreaterThan(
      style.indexOf(ruleFor(style, 'edge')),
    );
  });
});

describe('two-way edges', () => {
  const style = buildStyle(DEFAULT_PREFS);
  const indexOf = (selector) => style.findIndex((rule) => rule.selector === selector);
  const bidirectional = ruleFor(style, 'edge[bidirectional]').style;

  it('puts a head at the source end too', () => {
    expect(bidirectional['source-arrow-shape']).toBe('triangle');
    expect(ruleFor(style, 'edge').style['source-arrow-shape']).toBeUndefined();
  });

  it('says only the shape, so the kind rules still own the colour', () => {
    expect('source-arrow-color' in bidirectional).toBe(false);
    expect('line-color' in bidirectional).toBe(false);
    // The base rule colours the head unconditionally, so a one-way edge simply
    // never draws the one it colours.
    expect(ruleFor(style, 'edge').style['source-arrow-color']).toBe(
      ruleFor(style, 'edge').style['target-arrow-color'],
    );
    expect(indexOf('edge[kind="tactical-verb"]')).toBeGreaterThan(indexOf('edge[bidirectional]'));
  });
});

describe('derived edges', () => {
  const derived = ruleFor(buildStyle(DEFAULT_PREFS), 'edge[derived]').style;

  it('dashes a link that is not a triple in the store', () => {
    expect(derived['line-style']).toBe('dashed');
  });

  it('leaves the colour and the arrow alone, since kind and direction still hold', () => {
    expect('line-color' in derived).toBe(false);
    expect('target-arrow-shape' in derived).toBe(false);
  });

  it('grows with the number of child links it stands for, up to a cap', () => {
    expect(derivedEdgeWidth(1)).toBe(1.5);
    expect(derivedEdgeWidth(3)).toBeGreaterThan(derivedEdgeWidth(2));
    expect(derivedEdgeWidth(9)).toBe(derivedEdgeWidth(4));
    // A missing count must not compute NaN and blank the edge.
    expect(derivedEdgeWidth(undefined)).toBe(1.5);
  });
});

describe('a collapsed artifact path', () => {
  const style = buildStyle(DEFAULT_PREFS, ICON_SET);
  const indexOf = (selector) => style.findIndex((rule) => rule.selector === selector);
  const collapsed = ruleFor(style, 'edge[collapsed]').style;

  it('is told apart from a fold by its line style, not by its colour', () => {
    // Both are non-triples; they are not the same non-triple, so they must not look
    // identical. Colour and arrow stay alone for the same reason the fold's do: the
    // direction it draws is the direction the data moves.
    expect(collapsed['line-style']).toBe('dotted');
    expect(collapsed['line-style']).not.toBe(ruleFor(style, 'edge[derived]').style['line-style']);
    expect('line-color' in collapsed).toBe(false);
    expect('target-arrow-shape' in collapsed).toBe(false);
  });

  it('comes after the fold rule, since a collapsed path is also derived', () => {
    // Cytoscape takes each property from the last rule that sets it, and both rules
    // match a collapsed edge.
    expect(indexOf('edge[collapsed]')).toBeGreaterThan(indexOf('edge[derived]'));
  });
});

describe('a selected node', () => {
  const style = buildStyle(DEFAULT_PREFS, ICON_SET);
  const indexOf = (selector) => style.findIndex((rule) => rule.selector === selector);
  const selected = ruleFor(style, 'node:selected').style;

  it('says it with the border, leaving the fill to the taxonomy', () => {
    // Cytoscape's own `:selected` rule sets only `background-color`, which our
    // unconditional `node` rule overrides — which is why selection used to be
    // invisible. Setting it here too would take the category colour and, in icon
    // mode, the white chip behind the glyph.
    expect(selected['border-color']).toBeTruthy();
    expect(selected['border-width']).toBeGreaterThan(0);
    expect('background-color' in selected).toBe(false);
    expect('background-image' in selected).toBe(false);
  });

  it('outlines thinly — the colour carries it, not the weight', () => {
    // A heavier ring swallowed the small leaf it was marking.
    const container = ruleFor(style, 'node[isContainer]').style;
    expect(selected['border-width']).toBeLessThanOrEqual(container['border-width']);
  });

  it('comes after every rule that sets a border, which is what makes it win', () => {
    // Ordering *is* the mechanism: cytoscape takes each property from the last
    // rule that sets it, so this rule has to outrank the container's border and a
    // folded node's.
    expect(indexOf('node:selected')).toBeGreaterThan(indexOf('node[isContainer]'));
    expect(indexOf('node:selected')).toBeGreaterThan(indexOf('node[folded]'));
  });

  it('is distinguishable from a folded node, not layered on top of its meaning', () => {
    const folded = ruleFor(style, 'node[folded]').style;
    expect(selected['border-color']).not.toBe(resolve(folded['border-color'], element({})));
    expect(selected['border-width']).not.toBe(folded['border-width']);
  });
});

describe('a selected edge', () => {
  const style = buildStyle(DEFAULT_PREFS, ICON_SET);
  const indexOf = (selector) => style.findIndex((rule) => rule.selector === selector);
  const selected = ruleFor(style, 'edge:selected').style;

  it('says it with a halo, leaving the line to say what the link is', () => {
    // Three properties are already spoken for and all three have to survive being
    // selected: `line-color` is the link kind, `line-style` says the link is derived
    // from a fold, and `width` says how many child links it stands for.
    expect(selected['overlay-color']).toBeTruthy();
    expect(selected['overlay-opacity']).toBeGreaterThan(0);
    expect('line-color' in selected).toBe(false);
    expect('line-style' in selected).toBe(false);
    expect('width' in selected).toBe(false);
  });

  it('is the same colour selection is said in on a node', () => {
    expect(selected['overlay-color']).toBe(ruleFor(style, 'node:selected').style['border-color']);
  });

  it('comes after every other edge rule, which is what makes it win', () => {
    expect(indexOf('edge:selected')).toBeGreaterThan(indexOf('edge'));
    expect(indexOf('edge:selected')).toBeGreaterThan(indexOf('edge[kind="tactical-verb"]'));
    expect(indexOf('edge:selected')).toBeGreaterThan(indexOf('edge[derived]'));
    expect(indexOf('edge:selected')).toBeGreaterThan(indexOf('edge[collapsed]'));
  });
});

describe('path focus classes', () => {
  const style = buildStyle(DEFAULT_PREFS, ICON_SET);
  const indexOf = (selector) => style.findIndex((rule) => rule.selector === selector);

  it('dims non-focused nodes and edges without hiding them', () => {
    const nodeDim = ruleFor(style, 'node.path-focus-dim').style;
    const edgeDim = ruleFor(style, 'edge.path-focus-dim').style;
    expect(nodeDim.opacity).toBeLessThan(1);
    expect(edgeDim.opacity).toBeLessThan(1);
  });

  it('emphasizes focused nodes and edges', () => {
    const nodeFocused = ruleFor(style, 'node.path-focus-node').style;
    const edgeFocused = ruleFor(style, 'edge.path-focus-edge').style;
    expect(nodeFocused['border-width']).toBeGreaterThan(0);
    expect(edgeFocused['overlay-opacity']).toBeGreaterThan(0);
  });

  it('keeps node selection as the final style winner', () => {
    expect(indexOf('node:selected')).toBeGreaterThan(indexOf('node.path-focus-node'));
  });

  it('keeps edge selection as the final style winner', () => {
    expect(indexOf('edge:selected')).toBeGreaterThan(indexOf('edge.path-focus-edge'));
  });
});
