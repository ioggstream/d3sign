/**
 * The extension host's model, without the VS Code API (docs/adr/0043-vscode-extension.md).
 * What crosses to a webview must survive `postMessage`, so every result here is
 * pushed through JSON before it is asserted on.
 */

import { describe, it, expect } from 'vitest';
import { DataFactory } from 'n3';
import { createPipeline } from '../../vscode/src/pipeline.js';
import { fromFlatContribution, toFlatContribution } from '../../vscode/src/flat.js';

const { namedNode, literal, quad } = DataFactory;

const ENRICHMENT = `
@prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
<urn:x:a> d3f:reads <urn:x:b> .
`;
const DOC = '```mermaid\n---\nid: one\ntitle: T one\n---\ngraph\na[Host d3f:Host]\n```\n';
const wire = (value) => JSON.parse(JSON.stringify(value));

const newPipeline = () => createPipeline({ enrichmentTurtle: ENRICHMENT });

describe('flat contributions', () => {
  it('round-trip a graph with a language-tagged literal, in the graph that names it', () => {
    const name = 'urn:x:g';
    const original = {
      name,
      label: 'g',
      description: 'd',
      kind: 'query',
      quads: [
        quad(namedNode('urn:x:s'), namedNode('urn:x:p'), literal('ciao', 'it'), namedNode(name)),
        quad(namedNode('urn:x:s'), namedNode('urn:x:q'), namedNode('urn:x:o'), namedNode(name)),
      ],
    };
    const back = fromFlatContribution(wire(toFlatContribution(original)));
    expect(back.quads).toHaveLength(2);
    back.quads.forEach((q, i) => expect(q.equals(original.quads[i])).toBe(true));
  });
});

describe('createPipeline', () => {
  it('turns a document into serialisable contributions, one per graph', () => {
    const { warnings, contributions, knownGraphNames } = wire(newPipeline().update('file:///a.md', DOC));
    expect(warnings).toEqual([]);
    expect(contributions.map((c) => c.kind).sort()).toEqual(['diagram', 'enrichment']);
    expect(contributions.find((c) => c.kind === 'diagram').quads[0].subject.termType).toBe('NamedNode');
    expect(knownGraphNames).toEqual([contributions.find((c) => c.kind === 'diagram').name]);
  });

  it('keeps one model per document', () => {
    const pipeline = newPipeline();
    pipeline.update('file:///a.md', DOC);
    const other = pipeline.update('file:///b.md', '# no diagram here\n');
    expect(other.contributions.map((c) => c.kind)).toEqual(['enrichment']);
  });

  it('serialises the document as TriG', async () => {
    const pipeline = newPipeline();
    pipeline.update('file:///a.md', DOC);
    expect(await pipeline.trig('file:///a.md')).toContain('d3f:Host');
  });

  it('adds a graph from the webview, keeps it across a text change, and removes it', async () => {
    const pipeline = newPipeline();
    const { contributions } = pipeline.update('file:///a.md', DOC);
    const minted = { ...contributions.find((c) => c.kind === 'enrichment'), name: 'urn:x:minted', kind: 'query' };

    const known = pipeline.addGraph('file:///a.md', wire(minted));
    expect(known).not.toContain('urn:x:minted');
    const after = pipeline.update('file:///a.md', DOC);
    expect(after.contributions.map((c) => c.name)).toContain('urn:x:minted');

    expect(pipeline.removeGraph('file:///a.md', 'urn:x:minted')).not.toContain('urn:x:minted');
    expect(pipeline.update('file:///a.md', DOC).contributions.map((c) => c.name)).not.toContain('urn:x:minted');
  });

  it('forgets a document when it is closed', () => {
    const pipeline = newPipeline();
    pipeline.addGraph('file:///a.md', {
      name: 'urn:x:minted', label: 'm', description: '', kind: 'query', quads: [],
    });
    pipeline.dispose('file:///a.md');
    expect(pipeline.update('file:///a.md', DOC).contributions.map((c) => c.name)).not.toContain('urn:x:minted');
  });
});
