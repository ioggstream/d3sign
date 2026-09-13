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

/**
 * Splits testcases.md into { name, mermaid }, one entry per *independent scenario* —
 * which is usually, but not always, one per `## section-name` heading.
 *
 * A section may hold more than one block, and the two reasons are different.
 *
 * Some sections state a rule by contrast: `subgraph-with-property` shows a title that
 * names a property beside one that does not, and the second block is the whole content
 * of "Location classes are not special, if no property is specified". Those are two
 * scenarios and both must run — taking the first match left every such block
 * unexecuted.
 *
 * Others show one scenario *split across* blocks that merge: `merge-diagrams-with-same-id`
 * writes `id: merge-me` on both, and what it claims is true of the union, not of either
 * half. Snapshotting the second half alone would record an output the document never
 * asserts. A block whose `id:` an earlier block in the same section already used is
 * therefore skipped here; the merge deserves a test of its own, which it does not yet
 * have.
 *
 * The first block of a section keeps the section's own name, later ones are suffixed
 * `-2`, `-3`, … so the snapshot files already on disk keep their names.
 */
function parseTestcaseSections(markdown) {
  const headingRe = /^## (.+)$/gm;
  const headings = [...markdown.matchAll(headingRe)];
  return headings.flatMap((h, i) => {
    const name = h[1].trim();
    const start = h.index + h[0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : markdown.length;
    const body = markdown.slice(start, end);
    const seenIds = new Set();
    const scenarios = [];
    for (const [, mermaid] of body.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) {
      const id = /^\s*id:\s*(\S+)\s*$/m.exec(mermaid)?.[1];
      if (id && seenIds.has(id)) continue; // a continuation of the block before it
      if (id) seenIds.add(id);
      scenarios.push({
        name: scenarios.length === 0 ? name : `${name}-${scenarios.length + 1}`,
        mermaid,
      });
    }
    return scenarios;
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

  // A subgraph title naming a property says what the box stands for, and that is
  // what gets written. d3f:contains must not be written beside it: it is transitive,
  // so a nested box would compose a containment path nobody stated
  // (docs/adr/0032-rejected-cytoscape-container-node-by-relation.md).
  describe('a subgraph naming a property', () => {
    const quadsOf = (name) => {
      const section = sections.find((s) => s.name === name);
      const ast = parseDiagram(section.mermaid);
      return emitQuads(ast, ast.frontmatter.id || 'default').quads;
    };

    it('writes no d3f:contains', () => {
      expect(containsQuads('subgraph-with-property')).toEqual([]);
    });

    it('writes the named predicate from each member to the container', () => {
      const located = quadsOf('subgraph-with-property')
        .filter((q) => q.predicate.value.endsWith('#has-location'))
        .map((q) => [q.subject.value, q.object.value]);
      expect(located).toEqual([
        [nodeIri('webapp'), nodeIri('dc')],
        [nodeIri('browser'), nodeIri('dc')],
      ]);
    });

    // Naming d3f:contains is asking for the default, and it must not be inverted into
    // `ws-1 d3f:contains dc` — the containment family is stated from the container.
    it('keeps the container as the subject when the title names d3f:contains', () => {
      const { quads } = emitQuads(
        parseDiagram(
          ['graph', 'subgraph dc [DC d3f:contains d3f:PhysicalLocation]', '  a[A d3f:Host]', 'end'].join('\n'),
        ),
        'default',
      );
      const contains = quads
        .filter((q) => q.predicate.value.endsWith('#contains'))
        .map((q) => [q.subject.value, q.object.value]);
      expect(contains).toEqual([[nodeIri('dc'), nodeIri('a')]]);
    });

    // The property token is a predicate, not a type: before the class/property split
    // in parser/nodeParser.js it was emitted as `G:dc a d3f:has-location`.
    it('does not type the container with the property', () => {
      const types = quadsOf('subgraph-with-property')
        .filter((q) => q.subject.value === nodeIri('dc') && q.predicate.value.endsWith('#type'))
        .map((q) => q.object.value);
      expect(types.some((t) => t.endsWith('#has-location'))).toBe(false);
      expect(types.some((t) => t.endsWith('#PhysicalLocation'))).toBe(true);
    });

    // "Location classes are not special, if no property is specified" — testcases.md,
    // beside the second block this reads. Typing a subgraph d3f:PhysicalLocation does
    // not make its box mean anything but containment; only a property in the title
    // does, and there is none here.
    it('falls back to containment for a location class with no property', () => {
      const quads = quadsOf('subgraph-with-property-2');
      expect(
        quads
          .filter((q) => q.predicate.value.endsWith('#contains'))
          .map((q) => [q.subject.value, q.object.value]),
      ).toEqual([
        [nodeIri('dc'), nodeIri('webapp')],
        [nodeIri('dc'), nodeIri('browser')],
      ]);
      expect(quads.some((q) => q.predicate.value.endsWith('#has-location'))).toBe(false);
    });
  });

  // Only the *subgraph-title* route is exclusive: naming a property there replaces
  // containment. An ordinary edge line is emitted by a separate loop, so a node can
  // be contained by one thing and state its location about another at the same time.
  it('lets a nested node state its own location by an edge', () => {
    const { quads } = emitQuads(
      parseDiagram(
        [
          'graph',
          'subgraph a [rack d3f:Host]',
          '  h1[host d3f:Host]',
          'end',
          'a -->|d3f:has-location| rm',
          'rm[Roma d3f:PhysicalLocation]',
        ].join('\n'),
      ),
      'default',
    );
    const pairs = (suffix) =>
      quads
        .filter((q) => q.predicate.value.endsWith(suffix))
        .map((q) => [q.subject.value, q.object.value]);
    expect(pairs('#contains')).toEqual([[nodeIri('a'), nodeIri('h1')]]);
    expect(pairs('#has-location')).toEqual([[nodeIri('a'), nodeIri('rm')]]);
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

/**
 * What an edge endpoint denotes. The snapshots in testcases.md
 * (`subgraph-as-relationships*`) state the shapes; these are the refusals, which a
 * snapshot of the quads cannot show because the whole point is that there are none.
 */
describe('emitQuads — an edge endpoint that is not a resource', () => {
  const emit = (lines, options) => emitQuads(parseDiagram(['graph', ...lines].join('\n')), 'default', options);
  const linksOf = (quads, suffix) =>
    quads.filter((q) => q.predicate.value.endsWith(suffix)).map((q) => [q.subject.value, q.object.value]);

  // The containment rule applied to links: an id with no class is not a resource, so
  // it is no more the object of a triple than it is the child of a container.
  it('writes no quad for an untagged endpoint, and says which id it was', () => {
    const { quads, warnings } = emit(['a[Host d3f:Host]', 'a -->|d3f:reads| b']);
    expect(linksOf(quads, '#reads')).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"b"');
  });

  // Tagged-ness is a fact about the document, so a bare reference to an id another
  // block types is a resource here (multi-site-platform.md wires hosts this way).
  it('writes the quad when another block typed the endpoint', () => {
    const { quads, warnings } = emit(['a[Host d3f:Host]', 'a -->|d3f:reads| b'], {
      taggedIds: new Set(['b']),
    });
    expect(linksOf(quads, '#reads')).toEqual([[nodeIri('a'), nodeIri('b')]]);
    expect(warnings).toEqual([]);
  });

  it('distributes over the members of an untagged box, on either side', () => {
    const { quads } = emit([
      'subgraph pool',
      '  h-a[d3f:Host]',
      '  h-b[d3f:Host]',
      'end',
      'vip[d3f:ReverseProxyServer]',
      'log[d3f:LogFile]',
      'vip -->|d3f:connects| pool',
      'pool -->|d3f:writes| log',
    ]);
    expect(linksOf(quads, '#connects')).toEqual([
      [nodeIri('vip'), nodeIri('h-a')],
      [nodeIri('vip'), nodeIri('h-b')],
    ]);
    expect(linksOf(quads, '#writes')).toEqual([
      [nodeIri('h-a'), nodeIri('log')],
      [nodeIri('h-b'), nodeIri('log')],
    ]);
  });

  // One line must not write one triple per pair (ADR 0026, ADR 0032).
  it('refuses a box at both ends', () => {
    const { quads, warnings } = emit([
      'subgraph l',
      '  a[d3f:Host]',
      'end',
      'subgraph r',
      '  b[d3f:Host]',
      'end',
      'l -->|d3f:reads| r',
    ]);
    expect(linksOf(quads, '#reads')).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('both ends');
  });

  // A member of the box named on the other side would distribute into a loop.
  it('drops the self-pair when a member is named opposite its own box', () => {
    const { quads } = emit([
      'subgraph pool',
      '  h-a[d3f:Host]',
      '  h-b[d3f:Host]',
      'end',
      'pool -->|d3f:reads| h-a',
    ]);
    expect(linksOf(quads, '#reads')).toEqual([[nodeIri('h-b'), nodeIri('h-a')]]);
  });

  // Silence would lose a line the author wrote: the box is empty, or holds nothing
  // typed, so there is nothing to distribute over.
  it('warns when the box holds no typed member', () => {
    const { quads, warnings } = emit([
      'subgraph pool',
      '  untyped',
      'end',
      'vip[d3f:ReverseProxyServer]',
      'vip -->|d3f:connects| pool',
    ]);
    expect(linksOf(quads, '#connects')).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"pool"');
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
