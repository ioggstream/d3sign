import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Parser } from 'n3';
import { parseDiagram } from '../src/parser/index.js';
import { parseDocument } from '../src/parser/document.js';
import { emitQuads, expandCurie, inversePredicateOf, nodeIri } from '../src/rdf/emit.js';
import inverseMap from '../src/rdf/inverse-map.json';
import { toTurtle } from '../src/rdf/serialize.js';
import { GraphStore } from '../src/rdf/store.js';

const diagramsDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/examples');

function readFixture(name) {
  return readFileSync(path.join(diagramsDir, name), 'utf-8');
}

describe('emitQuads — ssh-authentication.md', () => {
  const ast = parseDiagram(readFixture('ssh-authentication.md'));
  const { quads } = emitQuads(ast, 'test');

  it('emits one rdf:type quad per class declared on a node', () => {
    const devPkIri = nodeIri('dev-pk');
    const declared = ast.nodes.find((n) => n.id === 'dev-pk').classes;
    const types = quads
      .filter((q) => q.subject.value === devPkIri && q.predicate.value.endsWith('#type'))
      .map((q) => q.object.value);
    expect(types.sort()).toEqual(declared.map(expandCurie).sort());
  });

  it('emits an edge quad with the d3f:decodes predicate', () => {
    const found = quads.find(
      (q) =>
        q.subject.value === nodeIri('dev') &&
        q.object.value === nodeIri('dev-pk') &&
        q.predicate.value.endsWith('#decodes'),
    );
    expect(found).toBeTruthy();
  });

});

/** Splits testcases.md into { name, mermaid } per `## section-name` heading. */
function parseTestcaseSections(markdown) {
  const headingRe = /^## (.+)$/gm;
  const headings = [...markdown.matchAll(headingRe)];
  return headings.map((h, i) => {
    const name = h[1].trim();
    const start = h.index + h[0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : markdown.length;
    const body = markdown.slice(start, end);
    const mermaid = /```mermaid\r?\n([\s\S]*?)```/.exec(body)[1];
    return { name, mermaid };
  });
}

describe('emitQuads — testcases.md scenarios (turtle snapshots)', () => {
  const sections = parseTestcaseSections(readFixture('testcases.md'));

  it.each(sections.map((s) => [s.name, s]))('%s', async (name, section) => {
    const ast = parseDiagram(section.mermaid);
    const diagramId = ast.frontmatter.id || 'default';
    const { quads } = emitQuads(ast, diagramId);
    const turtle = await toTurtle(quads);

    await expect(turtle).toMatchFileSnapshot(`snapshots/${name}.trig`);
  });
});

describe('emitQuads — containment as d3f:contains triples', () => {
  const sections = parseTestcaseSections(readFixture('testcases.md'));

  const containsQuads = (name) => {
    const section = sections.find((s) => s.name === name);
    const ast = parseDiagram(section.mermaid);
    const { quads } = emitQuads(ast, ast.frontmatter.id || 'default');
    return quads.filter((q) => q.predicate.value.endsWith('#contains'));
  };

  it('emits d3f:contains for a tagged subgraph', () => {
    expect(containsQuads('subgraph-contains-with-tag').length).toBeGreaterThan(0);
  });

  // An edge line is a mention: mermaid draws an endpoint inside the subgraph
  // that wires it up, even when the node was declared at top level.
  it('contains the endpoints of an edge declared inside the subgraph', () => {
    expect(containsQuads('subgraph-with-relationships').map((q) => [q.subject.value, q.object.value])).toEqual([
      [nodeIri('net'), nodeIri('a')],
      [nodeIri('net'), nodeIri('b')],
    ]);
  });

  it('emits no d3f:contains for an untagged subgraph', () => {
    expect(containsQuads('subgraph-ignored-without-tag')).toEqual([]);
  });

  // An untagged subgraph is presentational padding: it is not an entity, so its
  // children are inherited by the nearest tagged ancestor. Both spellings —
  // nested, and referenced-then-declared — must land on the same triple.
  describe.each([
    ['nested', 'inherit-subgraph-without-tag-1'],
    ['forward-referenced', 'inherit-subgraph-without-tag-2'],
  ])('untagged subgraph is transparent (%s)', (_shape, name) => {
    it('re-parents the child to the nearest tagged ancestor', () => {
      const contains = containsQuads(name);
      expect(contains.map((q) => [q.subject.value, q.object.value])).toEqual([
        [nodeIri('net'), nodeIri('a')],
      ]);
    });

    it('emits no quad at all about the untagged subgraph', () => {
      const section = sections.find((s) => s.name === name);
      const ast = parseDiagram(section.mermaid);
      const { quads } = emitQuads(ast, 'default');
      const padding = nodeIri('padding');
      expect(quads.filter((q) => q.subject.value === padding || q.object.value === padding)).toEqual([]);
    });
  });
});

describe('emitQuads — multi-graph.md (union across diagrams)', () => {
  const { diagrams } = parseDocument(readFixture('multi-graph.md'));

  it('emits quads from both diagrams into their own named graphs, merged in one store', () => {
    const store = new GraphStore();
    for (const d of diagrams) {
      const { quads, graphName } = emitQuads(d.ast, d.diagramId);
      store.replaceGraph(graphName, quads);
    }
    const all = store.getQuads();
    expect(all.some((q) => q.subject.value === nodeIri('client'))).toBe(true);
    expect(all.some((q) => q.subject.value === nodeIri('dc-1-app'))).toBe(true);
  });

  it('clears a diagram no longer present after re-parsing (stale graph cleanup)', () => {
    const store = new GraphStore();
    const graphNames = [];
    for (const d of diagrams) {
      const { quads, graphName } = emitQuads(d.ast, d.diagramId);
      store.replaceGraph(graphName, quads);
      graphNames.push(graphName);
    }
    expect(store.getQuads(graphNames[1]).length).toBeGreaterThan(0);

    // Simulate the diagram being removed on the next parse: clear its graph.
    store.replaceGraph(graphNames[1], []);
    expect(store.getQuads(graphNames[1]).length).toBe(0);
    expect(store.getQuads(graphNames[0]).length).toBeGreaterThan(0);
  });
});

describe('inversePredicateOf', () => {
  it('reads inverse-map.json in the direction it is written', () => {
    expect(inversePredicateOf('d3f:uses')).toBe('d3f:used-by');
  });

  it('answers for the passive leg too, which the file names only as a value', () => {
    // Several examples write `|d3f:used-by|` (001-layers.md, db-replica.md). Until the
    // reverse was derived those edges came out non-invertible: no swap item, no `s`.
    expect(inversePredicateOf('d3f:used-by')).toBe('d3f:uses');
    expect(inversePredicateOf('d3f:contained-by')).toBe('d3f:contains');
    for (const [predicate, inverse] of Object.entries(inverseMap)) {
      expect(inversePredicateOf(inverse), inverse).toBeTruthy();
      expect(inversePredicateOf(predicate)).toBe(inverse);
    }
  });

  it('carries the inverses D3FEND itself declares, not only hand-picked ones', () => {
    // owl:inverseOf pairs read off d3fend.ttl. The map used to hold four of them.
    expect(inversePredicateOf('d3f:creates')).toBe('d3f:created-by');
    expect(inversePredicateOf('d3f:modified-by')).toBe('d3f:modifies');
    expect(inversePredicateOf('d3f:may-detect')).toBe('d3f:may-be-detected-by');
    // D3FEND's inverse of d3f:depends-on, where the map used to invent
    // `d3f:dependency-of`, a property no vocabulary defines.
    expect(inversePredicateOf('d3f:depends-on')).toBe('d3f:has-dependent');
  });

  it('keeps a self-inverse predicate pointing at itself', () => {
    // d3f:communicates-with is D3FEND's only owl:SymmetricProperty.
    expect(inversePredicateOf('d3f:communicates-with')).toBe('d3f:communicates-with');
    expect(inversePredicateOf('d3f:connected-to')).toBe('d3f:connected-to');
  });

  it('has nothing to say about a predicate with no inverse to name', () => {
    expect(inversePredicateOf('d3f:related-to')).toBe(null);
    expect(inversePredicateOf('dpv:hasPurpose')).toBe(null);
  });
});

describe('turtle round-trip', () => {
  it('serializes and re-parses without error, matching quad count', async () => {
    const ast = parseDiagram(readFixture('ssh-authentication.md'));
    const { quads } = emitQuads(ast, 'test');
    const turtle = await toTurtle(quads);
    const reparsed = new Parser().parse(turtle);
    expect(reparsed.length).toBe(quads.length);
  });
});
