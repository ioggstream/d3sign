/**
 * The compound icon end to end: a diagram that types one node twice, through the
 * parser, the RDF, the model and the stylesheet, to the data URI cytoscape paints.
 *
 * The unit tests in icons.test.js compose from a stub set and say what the markup
 * has to be. This one says the classes survive the four layers in between — which
 * is where a node that is two things has always lost one of them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDiagram } from '../src/parser/index.js';
import { emitQuads } from '../src/rdf/emit.js';
import { GraphStore } from '../src/rdf/store.js';
import { buildGraphModel, modelPredicates } from '../src/rdf/graphModel.js';
import { toCytoscapeElements } from '../src/viz/toCytoscape.js';
import { buildStyle } from '../src/viz/graphStyle.js';
import { DEFAULT_PREFS } from '../src/viz/graphPrefs.js';
import { LINK_KINDS } from '../src/rdf/linkKind.js';
import { NODE_KINDS } from '../src/rdf/nodeKind.js';

const examplesDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/examples');

const ICON_SET = {
  prefix: 'd3f',
  width: 24,
  height: 24,
  icons: {
    ServiceApplication: { body: '<path fill="currentColor" d="M1 1h2z"/>' },
    CodeRepository: { body: '<path fill="currentColor" d="M3 3h4z"/>' },
  },
};

const SOURCE = `\`\`\`mermaid
graph LR
forge["d3f:ServiceApplication d3f:CodeRepository hosted forge"]
plain["d3f:ServiceApplication app"]
forge -->|d3f:copies| plain
\`\`\``;

/** The whole pipeline the app runs, from mermaid text to cytoscape elements. */
function render(source) {
  const ast = parseDiagram(source);
  const { quads, graphName } = emitQuads(ast, 'test');
  const store = new GraphStore();
  store.replaceGraph(graphName, quads);
  const model = buildGraphModel(store);
  const { elements } = toCytoscapeElements(model, {
    visiblePredicates: new Set(modelPredicates(model)),
    direction: new Map(),
    visibleKinds: new Set(LINK_KINDS),
    visibleNodeKinds: new Set(NODE_KINDS),
    foldedNodes: new Set(),
  });
  return elements;
}

const dataOf = (elements, id) => elements.find((e) => e.data.displayId === id)?.data;

describe('a node typed with two D3FEND classes', () => {
  const elements = render(SOURCE);

  it('keeps both classes through the parser and the RDF', () => {
    const forge = dataOf(elements, 'forge');
    expect(forge).toBeDefined();
    expect([...forge.typeNames].sort()).toEqual(['CodeRepository', 'ServiceApplication']);
  });

  it('leaves a singly-typed node without a type list', () => {
    expect(dataOf(elements, 'plain').typeNames).toBeUndefined();
  });

  it('paints the specific class, badged with what it is served as', () => {
    const style = buildStyle({ ...DEFAULT_PREFS, nodeStyle: 'icon' }, ICON_SET);
    const rule = style.find((r) => r.selector === 'node[typeName]').style;
    const ele = (data) => ({ data: (key) => (key === undefined ? data : data[key]) });

    const uri = rule['background-image'](ele(dataOf(elements, 'forge')));
    const svg = decodeURIComponent(String(uri).slice('data:image/svg+xml;utf8,'.length));
    expect(svg).toContain('<mask id="d3sign-badge"');
    // CodeRepository draws the glyph; ServiceApplication, which is in
    // BADGE_CLASSES, is the note in the corner.
    expect(svg).toMatch(/mask="url\(#d3sign-badge\)"><path fill="currentColor" d="M3 3h4z"/);
    expect(svg).toContain('d="M1 1h2z"');

    // The singly-typed node still goes through the plain path, untouched.
    const plain = rule['background-image'](ele(dataOf(elements, 'plain')));
    expect(decodeURIComponent(String(plain))).not.toContain('<mask');
  });
});

describe('the local-git example', () => {
  it('ships a node that exercises the compound icon', () => {
    const md = readFileSync(path.join(examplesDir, 'local-git.md'), 'utf-8');
    const forge = dataOf(render(md), 'forge');
    expect([...forge.typeNames].sort()).toEqual(['CodeRepository', 'ServiceApplication']);
  });
});
