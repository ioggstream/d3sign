/**
 * Architecture template expansion (docs/adr/0031-architecture-templates.md).
 *
 * The specification is app/src/data/examples/testcase-template.md, whose section
 * holds three mermaid blocks: the template, the diagram that instantiates it,
 * and — as documentation — the expanded source expansion is expected to produce.
 * The third block is *output*, so it is not fed to the parser as input; it is
 * asserted against instead, by comparing the quads it yields with the quads the
 * generated expansion yields. That keeps the file honest without pinning the
 * generator to exact whitespace.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDiagram } from '../src/parser/index.js';
import { parseDocument, extractMermaidBlocks } from '../src/parser/document.js';
import { expandDocument, templateRegistry } from '../src/parser/templates.js';
import { collectTaggedIds, emitQuads, nodeIri, expandCurie, PREFIXES, PROVENANCE } from '../src/rdf/emit.js';
import { buildGraphModel, modelPredicates } from '../src/rdf/graphModel.js';
import { GraphStore } from '../src/rdf/store.js';

const examplesDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/examples');
const fixture = readFileSync(path.join(examplesDir, 'testcase-template.md'), 'utf-8');
const blocks = extractMermaidBlocks(fixture);

/** The document under test: the template and the diagram instantiating it. */
const inputDocument = blocks
  .slice(0, 2)
  .map((b) => '```mermaid\n' + b.source + '```')
  .join('\n\n');

/** The third block: the expansion the file documents. */
const documentedExpansion = blocks[2].source;

function emitDocument(markdown) {
  const { diagrams } = parseDocument(markdown, { defaultDiagramId: 'current' });
  const { diagrams: expanded, warnings } = expandDocument(diagrams);
  const taggedIds = collectTaggedIds(expanded);
  const quads = [];
  for (const d of expanded) {
    if (d.isTemplate) continue;
    quads.push(...emitQuads(d.ast, d.diagramId, { taggedIds, provenance: d.provenance }).quads);
  }
  return { diagrams: expanded, quads, warnings };
}

const { diagrams, quads, warnings } = emitDocument(inputDocument);
const instanceDiagram = diagrams.find((d) => !d.isTemplate);

const triples = quads.map((q) => [q.subject.value, q.predicate.value, q.object.value]);
const has = (s, p, o) => triples.some(([qs, qp, qo]) => qs === s && qp === p && qo === o);
const objectsOf = (s, p) => triples.filter(([qs, qp]) => qs === s && qp === p).map(([, , o]) => o);
const TYPE = PREFIXES.rdf + 'type';
const LABEL = PREFIXES.rdfs + 'label';
const CONTAINS = expandCurie('d3f:contains');

describe('template expansion — the fixture parses cleanly', () => {
  it('reports no warnings', () => {
    const astWarnings = diagrams.flatMap((d) => d.ast.warnings);
    expect([...warnings, ...astWarnings]).toEqual([]);
  });

  it('registers the template and reads its root from frontmatter', () => {
    const { templates } = templateRegistry(diagrams);
    expect([...templates.keys()]).toEqual(['HostTemplate']);
    expect(templates.get('HostTemplate').root).toBe('host');
  });

  it('marks the template block, so it contributes no graph of its own', () => {
    const template = diagrams.find((d) => d.isTemplate);
    expect(template).toBeTruthy();
    expect(template.diagramId).toBe('HostTemplate');
    expect(triples.some(([s]) => s === nodeIri('host') || s === nodeIri('nic'))).toBe(false);
  });
});

describe('template expansion — the instance', () => {
  it('types the root from the template root and labels it from the call site', () => {
    expect(has(nodeIri('ws-1'), TYPE, expandCurie('d3f:Host'))).toBe(true);
    expect(has(nodeIri('ws-1'), LABEL, 'Web Server 1')).toBe(true);
    expect(has(nodeIri('ws-2'), LABEL, 'Web Server 2')).toBe(true);
  });

  it('clones every unmarked member under the instance id', () => {
    for (const instance of ['ws-1', 'ws-2']) {
      expect(has(nodeIri(`${instance}-nic`), TYPE, expandCurie('d3f:NetworkInterfaceCard'))).toBe(true);
      expect(has(nodeIri(`${instance}-ip`), TYPE, expandCurie('d3f:IPAddress'))).toBe(true);
    }
  });

  it('names no bare member id: a member exists only under its instance', () => {
    for (const bare of ['nic', 'ip']) {
      expect(triples.some(([s, , o]) => s === nodeIri(bare) || o === nodeIri(bare))).toBe(false);
    }
  });

  it('reproduces the template relation between the instance\'s own members', () => {
    expect(has(nodeIri('ws-1-ip'), expandCurie('d3f:identifies'), nodeIri('ws-1'))).toBe(true);
    expect(has(nodeIri('ws-2-ip'), expandCurie('d3f:identifies'), nodeIri('ws-2'))).toBe(true);
    // Never across instances.
    expect(has(nodeIri('ws-1-ip'), expandCurie('d3f:identifies'), nodeIri('ws-2'))).toBe(false);
  });

  it('contains only what the template nested inside its root', () => {
    expect(objectsOf(nodeIri('ws-1'), CONTAINS)).toEqual([nodeIri('ws-1-nic')]);
    expect(objectsOf(nodeIri('ws-2'), CONTAINS)).toEqual([nodeIri('ws-2-nic')]);
    // The address is a member the host does not contain.
    expect(has(nodeIri('ws-1'), CONTAINS, nodeIri('ws-1-ip'))).toBe(false);
  });

  it('keeps the edge written at the call site, between the roots', () => {
    expect(has(nodeIri('ws-1'), expandCurie('d3f:accesses'), nodeIri('ws-2'))).toBe(true);
  });
});

describe('template expansion — shared members', () => {
  it('states a :::shared member once, with its own id', () => {
    expect(has(nodeIri('dns'), TYPE, expandCurie('d3f:DNSServer'))).toBe(true);
    expect(triples.filter(([s, p]) => s === nodeIri('dns') && p === TYPE)).toHaveLength(1);
  });

  it('is never prefixed per instance', () => {
    expect(triples.some(([s]) => s === nodeIri('ws-1-dns') || s === nodeIri('ws-2-dns'))).toBe(false);
  });

  it('is pointed at by every instance', () => {
    expect(has(nodeIri('ws-1'), expandCurie('d3f:uses'), nodeIri('dns'))).toBe(true);
    expect(has(nodeIri('ws-2'), expandCurie('d3f:uses'), nodeIri('dns'))).toBe(true);
  });

  it('belongs to no instance, so it carries no provenance', () => {
    expect(objectsOf(nodeIri('dns'), PROVENANCE.partOf)).toEqual([]);
  });
});

describe('template expansion — provenance', () => {
  it('records the template on each instance root, once', () => {
    expect(objectsOf(nodeIri('ws-1'), PROVENANCE.instantiates)).toEqual([PREFIXES.T + 'HostTemplate']);
    expect(objectsOf(nodeIri('ws-2'), PROVENANCE.instantiates)).toEqual([PREFIXES.T + 'HostTemplate']);
  });

  it('records one statement per cloned member and none for the root', () => {
    const partOf = triples.filter(([, p]) => p === PROVENANCE.partOf);
    expect(partOf.map(([s, , o]) => [s, o]).sort()).toEqual(
      [
        [nodeIri('ws-1-nic'), nodeIri('ws-1')],
        [nodeIri('ws-1-ip'), nodeIri('ws-1')],
        [nodeIri('ws-2-nic'), nodeIri('ws-2')],
        [nodeIri('ws-2-ip'), nodeIri('ws-2')],
      ].sort(),
    );
    expect(objectsOf(nodeIri('ws-1'), PROVENANCE.partOf)).toEqual([]);
  });

  /**
   * A template groups its members with plain subgraphs as any diagram does, and an
   * untagged one is padding — not a resource (ADR 0003). Expansion clones it like
   * every other member, and provenance about it used to be enough to mint it:
   * `buildGraphModel` makes a node for the subject of every quad, so
   * `G:r0-fe ds:partOf G:r0` drew a typeless box inside each instance
   * (docs/external/gcp/gcp-multi-region.md, whose `fe`/`be`/`data` are exactly this).
   */
  describe('an untagged grouping subgraph inside a template', () => {
    const document = [
      '```mermaid',
      '---',
      'kind: template',
      'id: Pod',
      'root: pod',
      '---',
      'graph',
      'subgraph pod [d3f:Host]',
      'end',
      'subgraph pad',
      '  web[d3f:WebServerApplication]',
      '  cache[d3f:Cache]',
      'end',
      '```',
      '',
      '```mermaid',
      'graph',
      'p0[Pod zero T:Pod]',
      '```',
    ].join('\n');
    const emitted = emitDocument(document);
    const pad = nodeIri('p0-pad');

    it('is in no quad at all', () => {
      expect(emitted.quads.filter((q) => q.subject.value === pad || q.object.value === pad)).toEqual([]);
    });

    it('leaves its typed members as members of the instance', () => {
      const partOf = emitted.quads
        .filter((q) => q.predicate.value === PROVENANCE.partOf)
        .map((q) => [q.subject.value, q.object.value]);
      expect(partOf.sort()).toEqual(
        [
          [nodeIri('p0-web'), nodeIri('p0')],
          [nodeIri('p0-cache'), nodeIri('p0')],
        ].sort(),
      );
    });

    it('is therefore not a node in the graph model', () => {
      const store = new GraphStore();
      store.replaceGraph('urn:d3fend-graph:current', emitted.quads);
      const model = buildGraphModel(store);
      expect(model.nodes.has(pad)).toBe(false);
      expect(model.parentOf.get(nodeIri('p0-web'))).toBe(nodeIri('p0'));
    });
  });
});

describe('template expansion — the expanded source', () => {
  it('is derived, not written back to the document', () => {
    expect(instanceDiagram.expandedSource).toBeTruthy();
    expect(instanceDiagram.source).toContain('T:HostTemplate');
    expect(instanceDiagram.expandedSource).not.toContain('T:HostTemplate');
  });

  it('is valid input to the parser and keeps the calling diagram id', () => {
    const reparsed = parseDiagram(instanceDiagram.expandedSource);
    expect(reparsed.warnings).toEqual([]);
    expect(reparsed.frontmatter.id).toBe('template-two-instances');
  });

  it('carries no :::shared marker: expansion has consumed it', () => {
    expect(instanceDiagram.expandedSource).not.toContain(':::shared');
  });

  // The file documents the expansion it expects; this is what makes that block
  // an assertion rather than a comment.
  it('yields the quads the documented expansion yields', () => {
    const documented = emitQuads(parseDiagram(documentedExpansion), 'template-two-instances').quads;
    const key = (list) =>
      list
        .filter((q) => !Object.values(PROVENANCE).includes(q.predicate.value))
        .map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`)
        .sort();
    expect(key(quads)).toEqual(key(documented));
  });
});

describe('template expansion — what the graph view does with it', () => {
  const store = new GraphStore();
  store.replaceGraph(`urn:d3fend-graph:template-two-instances`, quads);
  const model = buildGraphModel(store);

  it('groups a member into its instance without drawing a link', () => {
    expect(model.parentOf.get(nodeIri('ws-1-ip'))).toBe(nodeIri('ws-1'));
    expect(modelPredicates(model)).not.toContain('ds:partOf');
  });

  it('lets containment win the parent where both could place a member', () => {
    // ws-1-nic is both contained by ws-1 and a member of it; one parent either way.
    expect(model.parentOf.get(nodeIri('ws-1-nic'))).toBe(nodeIri('ws-1'));
  });

  it('keeps the template out of the drawing entirely', () => {
    expect(model.nodes.has(PREFIXES.T + 'HostTemplate')).toBe(false);
    expect(modelPredicates(model)).not.toContain('ds:instantiates');
  });

  it('still draws the relations the template stated', () => {
    const drawn = model.edges.map((e) => `${e.from} ${e.predicate} ${e.to}`);
    expect(drawn).toContain(`${nodeIri('ws-1-ip')} d3f:identifies ${nodeIri('ws-1')}`);
    expect(drawn).toContain(`${nodeIri('ws-1')} d3f:uses ${nodeIri('dns')}`);
  });
});

describe('template expansion — refusals', () => {
  const wrap = (body) => '```mermaid\n' + body + '\n```';

  it('warns and leaves the node alone when the template is unknown', () => {
    const { quads: q, warnings: w } = emitDocument(
      wrap('---\nid: d\ntitle: d\n---\ngraph\na[Thing T:Missing]'),
    );
    expect(w.join(' ')).toContain('Unknown template "T:Missing"');
    expect(q).toEqual([]);
  });

  it('warns when a template names a root it does not declare', () => {
    const { warnings: w } = emitDocument(
      [
        wrap('---\nid: Bad\nkind: template\nroot: nowhere\ntitle: Bad\n---\ngraph\nx[d3f:Host]'),
        wrap('---\nid: d\ntitle: d\n---\ngraph\na[Thing T:Bad]'),
      ].join('\n\n'),
    );
    expect(w.join(' ')).toContain('names root "nowhere"');
  });

  it('stops a template that instantiates itself', () => {
    const { warnings: w } = emitDocument(
      [
        wrap('---\nid: Loop\nkind: template\nroot: r\ntitle: Loop\n---\ngraph\nsubgraph r[d3f:Host]\n  inner[T:Loop d3f:Host]\nend'),
        wrap('---\nid: d\ntitle: d\n---\ngraph\na[Thing T:Loop]'),
      ].join('\n\n'),
    );
    expect(w.join(' ')).toContain('already being expanded');
  });

  it('refuses a reference tucked into an edge endpoint', () => {
    const { diagrams: ds } = emitDocument(
      [
        wrap('---\nid: T1\nkind: template\nroot: r\ntitle: T1\n---\ngraph\nr[d3f:Host]'),
        wrap('---\nid: d\ntitle: d\n---\ngraph\nb[d3f:Host]\nb -->|d3f:uses| a[Thing T:T1]'),
      ].join('\n\n'),
    );
    const astWarnings = ds.flatMap((d) => d.ast.warnings);
    expect(astWarnings.join(' ')).toContain('declare the node on its own line');
  });
});
