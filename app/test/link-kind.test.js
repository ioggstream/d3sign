import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDiagram } from '../src/parser/index.js';
import { emitQuads } from '../src/rdf/emit.js';
import { GraphStore } from '../src/rdf/store.js';
import { buildGraphModel } from '../src/rdf/graphModel.js';
import {
  classifyPredicate,
  LINK_KINDS,
  LOCATION_PREDICATES,
  PRIVACY_PREDICATES,
} from '../src/rdf/linkKind.js';
import legalTerms from '../src/data/legal-completions.json';

const diagramsDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/examples');

function readFixture(name) {
  return readFileSync(path.join(diagramsDir, name), 'utf-8');
}

describe('classifyPredicate', () => {
  // One representative per kind. The full tables live in linkKind.js; this only
  // pins the cases whose placement is a judgement call worth defending.
  it.each([
    ['d3f:reads', 'data-flow'],
    // Inherits from d3f:accesses, so it carries data despite reading as control.
    ['d3f:executes', 'data-flow'],
    ['d3f:controls', 'control-flow'],
    ['d3f:hardens', 'tactical-verb'],
    // A tactical verb, not control flow: it is a d3fend-tactical-verb-property.
    ['d3f:authenticates', 'tactical-verb'],
    ['d3f:connected-to', 'connectivity'],
    // Where a node sits. It was the `other` bucket's own example until it earned a
    // colour, and the DPV pair joins it rather than `privacy`: "where" is not "why".
    ['d3f:has-location', 'location'],
    ['dpv:hasLocation', 'location'],
    ['dpv:isOutsideOfLocation', 'location'],
    // d3f:connects joins equipment, not networks — deliberately not connectivity.
    ['d3f:connects', 'other'],
    ['d3f:related', 'other'],
    ['d3f:some-future-predicate', 'other'],
  ])('classifies %s as %s', (predicate, kind) => {
    expect(classifyPredicate(predicate)).toBe(kind);
  });

  it('only ever returns a declared kind', () => {
    expect(LINK_KINDS).toContain(classifyPredicate('d3f:whatever'));
  });

  // The counterpart of artifact-flow.test.js's check on its D3FEND set. A predicate
  // nobody can write is never classified, so an invented one is invisible until the
  // table is read as documentation — which is how `dpv:hasPersonalDataCategory`, a
  // name that reads as though it must exist, got into this set on the first draft.
  //
  // Skipped until build-legal-metadata.py has run, like the rest of the suite's
  // projection-dependent assertions.
  const dpvTerms = legalTerms.dpv ?? {};
  const dpvMembers = [...PRIVACY_PREDICATES, ...LOCATION_PREDICATES].filter((curie) =>
    curie.startsWith('dpv:'),
  );
  it.skipIf(!Object.keys(dpvTerms).length)('names only real DPV properties', () => {
    for (const curie of dpvMembers) {
      const term = dpvTerms[curie.slice('dpv:'.length)];
      expect(term, `${curie} is not in the DPV projection`).toBeTruthy();
      expect(term.kind, curie).toBe('property');
    }
  });
});

describe('buildGraphModel — attaches kind to edges', () => {
  it('classifies d3f:decodes as data-flow', () => {
    const ast = parseDiagram(readFixture('ssh-authentication.md'));
    const { quads, graphName } = emitQuads(ast, 'test');
    const store = new GraphStore();
    store.replaceGraph(graphName, quads);

    const decodes = buildGraphModel(store).edges.find((e) => e.predicate === 'd3f:decodes');
    expect(decodes.kind).toBe('data-flow');
  });

  // The corpus reaches d3f:has-location through the subgraph-with-property syntax
  // (testcases.md, `subgraph dc [EU-RM d3f:has-location …]`) rather than by drawing an
  // arrow, so that is the path worth pinning.
  it('classifies d3f:has-location as location', () => {
    const ast = parseDiagram(`\`\`\`mermaid
graph
subgraph dc [EU-RM d3f:has-location d3f:PhysicalLocation]
  webapp[Web Application d3f:WebApplication]
end
\`\`\``);
    const { quads, graphName } = emitQuads(ast, 'test');
    const store = new GraphStore();
    store.replaceGraph(graphName, quads);

    const located = buildGraphModel(store).edges.find(
      (e) => e.predicate === 'd3f:has-location',
    );
    expect(located).toBeTruthy();
    expect(located.kind).toBe('location');
  });

  it('classifies d3f:connected-to as connectivity', () => {
    const ast = parseDiagram(readFixture('002-network.md'));
    const { quads, graphName } = emitQuads(ast, 'test');
    const store = new GraphStore();
    store.replaceGraph(graphName, quads);

    const edges = buildGraphModel(store).edges;
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.kind === 'connectivity')).toBe(true);
  });
});
