/**
 * The text → contributions step that the SPA and the VS Code host share
 * (docs/adr/0043-vscode-extension.md). Inline documents on purpose: a test of the
 * model must not move when an example diagram is edited.
 */

import { describe, it, expect } from 'vitest';
import { createDocumentModel } from '../src/rdf/documentModel.js';
import { ENRICHMENT_GRAPH } from '../src/rdf/enrichment.js';

const ENRICHMENT = `
@prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
<urn:x:a> d3f:reads <urn:x:b> .
`;

const block = (id, body) => `\`\`\`mermaid\n---\nid: ${id}\ntitle: T ${id}\n---\ngraph\n${body}\n\`\`\`\n`;
const ONE = block('one', 'a[Host d3f:Host]');
const TWO = block('two', 'b[Host d3f:Host]');

const newModel = () => createDocumentModel({ enrichmentTurtle: ENRICHMENT });
const diagramIds = (model) =>
  model.contributions().filter((c) => c.kind === 'diagram').map((c) => c.description);

describe('createDocumentModel.setText', () => {
  it('yields one diagram contribution per diagram, and the enrichment graph', () => {
    const model = newModel();
    const { diagrams, warnings } = model.setText(ONE + TWO);
    expect(diagrams).toHaveLength(2);
    expect(warnings).toEqual([]);
    expect(diagramIds(model)).toEqual(['one', 'two']);
    expect(model.get(ENRICHMENT_GRAPH)?.kind).toBe('enrichment');
    expect(model.get(ENRICHMENT_GRAPH).quads).toHaveLength(1);
  });

  it('drops the graph of a diagram the text no longer declares, keeps the enrichment', () => {
    const model = newModel();
    model.setText(ONE + TWO);
    model.setText(ONE);
    expect(diagramIds(model)).toEqual(['one']);
    expect(model.get(ENRICHMENT_GRAPH)).toBeDefined();
  });

  it('reports a link that emits nothing', () => {
    const model = newModel();
    const { warnings } = model.setText(block('one', 'a[Host d3f:Host]\nb[Host d3f:Host]\na -->|reads| b'));
    expect(warnings.some((w) => w.includes('reads'))).toBe(true);
  });
});

describe('createDocumentModel.add / remove', () => {
  const extra = (name) => ({ name, label: name, description: 'x', kind: 'query', quads: [] });

  it('keeps a graph added without sweepable across a text change', () => {
    const model = newModel();
    model.setText(ONE);
    model.add(extra('urn:x:minted'));
    model.setText(TWO);
    expect(model.get('urn:x:minted')).toBeDefined();
  });

  it('drops a sweepable graph on the next text change', () => {
    const model = newModel();
    model.setText(ONE);
    model.add(extra('urn:x:construct'), { sweepable: true });
    expect(model.knownGraphNames().has('urn:x:construct')).toBe(true);
    model.setText(ONE);
    expect(model.get('urn:x:construct')).toBeUndefined();
  });

  it('removes a graph and forgets that it was known', () => {
    const model = newModel();
    model.setText(ONE);
    model.add(extra('urn:x:construct'), { sweepable: true });
    expect(model.remove('urn:x:construct')).toBe(true);
    expect(model.get('urn:x:construct')).toBeUndefined();
    expect(model.knownGraphNames().has('urn:x:construct')).toBe(false);
    expect(model.remove('urn:x:construct')).toBe(false);
  });
});

describe('createDocumentModel TriG round trip', () => {
  it('reads back what it wrote, keeping each graph’s label and kind', async () => {
    const model = newModel();
    model.setText(ONE);
    const before = model.contributions().map((c) => [c.name, c.label, c.kind, c.quads.length]);
    const trig = await model.toTrig();
    expect(model.replaceFromTrig(trig)).toEqual({});
    expect(model.contributions().map((c) => [c.name, c.label, c.kind, c.quads.length])).toEqual(before);
  });

  it('leaves the contributions alone when the TriG does not parse', () => {
    const model = newModel();
    model.setText(ONE);
    const before = model.contributions();
    const result = model.replaceFromTrig('this is not trig {');
    expect(result.error).toBeTruthy();
    expect(model.contributions()).toEqual(before);
  });

  it('turns a deleted block into a deleted graph', async () => {
    const model = newModel();
    model.setText(ONE + TWO);
    // The document as it reads once the second diagram's block is gone.
    const other = newModel();
    other.setText(ONE);
    model.replaceFromTrig(await other.toTrig());
    expect(model.contributions().map((c) => c.name)).toEqual(
      other.contributions().map((c) => c.name),
    );
    expect(diagramIds(model)).toEqual(['one']);
  });
});
