import { describe, it, expect } from 'vitest';
import { quadFromFlat, quadsFromFlat } from '../src/query/flatQuads.js';
import { toTurtle } from '../src/rdf/serialize.js';

const iri = (value) => ({ termType: 'NamedNode', value });
const GRAPH = 'urn:d3fend-graph:query:enrichment';

const flat = {
  subject: iri('urn:d3fend-graph:db-1'),
  predicate: iri('http://d3fend.mitre.org/ontologies/d3fend.owl#hardened-by'),
  object: iri('urn:d3fend-graph:scrubber'),
  // The CONSTRUCT's own graph term, which must not survive.
  graph: iri('urn:d3fend-graph:current'),
};

describe('quadFromFlat', () => {
  it('rebuilds a quad in the named graph the user chose, not the query result’s', () => {
    const quad = quadFromFlat(flat, GRAPH);
    expect(quad.subject.value).toBe('urn:d3fend-graph:db-1');
    expect(quad.predicate.value).toContain('hardened-by');
    expect(quad.object.value).toBe('urn:d3fend-graph:scrubber');
    expect(quad.graph.value).toBe(GRAPH);
  });

  it('rebuilds literals with their language or datatype, never both', () => {
    const withLang = quadFromFlat(
      { ...flat, object: { termType: 'Literal', value: 'ciao', language: 'it', datatype: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' } },
      GRAPH,
    );
    expect(withLang.object.language).toBe('it');

    const withType = quadFromFlat(
      { ...flat, object: { termType: 'Literal', value: '7', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
      GRAPH,
    );
    expect(withType.object.datatype.value).toBe('http://www.w3.org/2001/XMLSchema#integer');
    expect(withType.object.language).toBe('');
  });

  it('rebuilds blank nodes', () => {
    const quad = quadFromFlat({ ...flat, object: { termType: 'BlankNode', value: 'b0' } }, GRAPH);
    expect(quad.object.termType).toBe('BlankNode');
  });

  it('refuses a quad that is not RDF rather than building a broken one', () => {
    expect(quadFromFlat({ ...flat, subject: { termType: 'Literal', value: 'x' } }, GRAPH)).toBeNull();
    expect(quadFromFlat({ ...flat, predicate: { termType: 'BlankNode', value: 'b' } }, GRAPH)).toBeNull();
    expect(quadFromFlat({ ...flat, object: null }, GRAPH)).toBeNull();
  });

  it('drops the unbuildable ones and keeps the rest', () => {
    const quads = quadsFromFlat([flat, { ...flat, object: null }, flat], GRAPH);
    expect(quads).toHaveLength(2);
  });

  it('produces quads the document serializer accepts, since they join the TriG pane', async () => {
    const turtle = await toTurtle(quadsFromFlat([flat], GRAPH));
    // No Q: prefix is declared for the document, so the graph is written in full.
    expect(turtle).toContain('urn:d3fend-graph:query:enrichment');
    expect(turtle).toContain('d3f:hardened-by');
  });
});
