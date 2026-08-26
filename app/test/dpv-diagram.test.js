/**
 * A diagram written in DPV, end to end: mermaid → quads → turtle → view model.
 *
 * Guards docs/adr/0028-support-data-privacy-vocabulary.md. Four of these assertions
 * are about things that were silently wrong rather than merely missing, and are the
 * reason this file exists rather than a couple of parser cases:
 *
 *   - a non-writable prefix must stay in the label (`Cache risk:high`), because the
 *     class-token regex consumes its prefixes anywhere in a node's text;
 *   - a prefixed edge predicate must not be re-prefixed into `d3f:dpv:hasDataSubject`;
 *   - a `dpv:`-only subgraph must be a container, not presentational padding;
 *   - a `dpv:` type must reach the view as `dpv:X`, not as a full https URL.
 */

import { describe, it, expect } from 'vitest';
import { Store } from 'n3';
import { parseDiagram } from '../src/parser/index.js';
import { emitQuads, isWritablePredicate } from '../src/rdf/emit.js';
import { toTurtle } from '../src/rdf/serialize.js';
import { buildGraphModel } from '../src/rdf/graphModel.js';
import legalCategories from '../src/data/legal-categories.json';

const D3F = 'http://d3fend.mitre.org/ontologies/d3fend.owl#';
const DPV = 'https://w3id.org/dpv#';
const EU_GDPR = 'https://w3id.org/dpv/legal/eu/gdpr#';

// `proc` carries only a dpv: type: under ADR 0028 as first drafted it would have been
// read as padding and emitted nothing. `CACHE` carries two prefixes a diagram may not
// write. `T` pins the ATT&CK dotted-id rule against the generalised prefix alternation.
const SOURCE = `graph TD
  subgraph proc[Signup dpv:PersonalDataHandling]
    DB[(Customers dpv:PersonalData d3f:Database)]
    API[Portal d3f:WebServerApplication]
  end
  U[Alice eu-gdpr:DataSubject]
  CACHE[Cache risk:high tech:Foo]
  T[Sub d3f:T1548.001]
  API -->|dpv:hasDataSubject| U
  API -->|d3f:reads| DB
  API -->|accesses| U
`;

const ast = parseDiagram(SOURCE);
const { quads } = emitQuads(ast, 'current');
const nodeOf = (id) => ast.nodes.find((n) => n.id === id);
const typesOf = (id) =>
  quads
    .filter((q) => q.subject.value === `urn:d3fend-graph:${id}` && q.predicate.value.endsWith('#type'))
    .map((q) => q.object.value)
    .sort();

describe('a diagram written in DPV', () => {
  it('parses without the unsupported-syntax warning', () => {
    expect(ast.warnings.join(' ')).not.toMatch(/unsupported syntax/);
  });

  it('types nodes from every writable vocabulary', () => {
    expect(typesOf('DB')).toEqual([`${D3F}Database`, `${DPV}PersonalData`]);
    expect(typesOf('U')).toEqual([`${EU_GDPR}DataSubject`]);
  });

  it('still reads an ATT&CK dotted id as one class', () => {
    expect(typesOf('T')).toEqual([`${D3F}T1548.001`]);
  });

  it('leaves a non-writable prefix in the free-text label', () => {
    expect(nodeOf('CACHE').classes).toEqual([]);
    expect(nodeOf('CACHE').label).toBe('Cache risk:high tech:Foo');
    expect(typesOf('CACHE')).toEqual([]);
  });

  it('makes a dpv-only subgraph a real container', () => {
    expect(typesOf('proc')).toEqual([`${DPV}PersonalDataHandling`]);
    const contained = quads
      .filter((q) => q.predicate.value === `${D3F}contains`)
      .map((q) => q.object.value.replace('urn:d3fend-graph:', ''))
      .sort();
    expect(contained).toEqual(['API', 'DB']);
  });
});

describe('edge predicates', () => {
  it('accepts a label in any writable vocabulary', () => {
    expect(isWritablePredicate('d3f:reads')).toBe(true);
    expect(isWritablePredicate('dpv:hasDataSubject')).toBe(true);
  });

  it('rejects a bare label and an unwritable prefix', () => {
    // A bare label used to be expanded to `d3f:<label>`. It cannot tell a shorthand
    // for a real property from prose between the pipes, so mta.md's `|a|` and
    // `|subClassOf|` became `d3f:a` and `d3f:subClassOf` — predicates in no vocabulary.
    expect(isWritablePredicate('accesses')).toBe(false);
    expect(isWritablePredicate('subClassOf')).toBe(false);
    expect(isWritablePredicate('risk:foo')).toBe(false);
  });

  it('emits the DPV predicate itself', () => {
    const predicates = quads.map((q) => q.predicate.value);
    expect(predicates).toContain(`${DPV}hasDataSubject`);
    expect(predicates.some((p) => p.startsWith(`${D3F}dpv:`))).toBe(false);
  });

  it('drops a bare label with a warning, keeping its endpoints', () => {
    expect(quads.some((q) => q.predicate.value === `${D3F}accesses`)).toBe(false);
    expect(ast.warnings.join('\n')).toMatch(/Ignored edge label "accesses"/);
    // The endpoints were still mentioned, so they are still declared.
    expect(typesOf('U')).toEqual([`${EU_GDPR}DataSubject`]);
  });
});

describe('the serialised document', () => {
  it('declares the vocabularies it uses and no others', async () => {
    const turtle = await toTurtle(quads);
    expect(turtle).toContain('@prefix dpv:');
    expect(turtle).toContain('@prefix eu-gdpr:');
    // Reachable in a document, but not from a diagram — so not in this header.
    expect(turtle).not.toContain('@prefix al:');
    expect(turtle).not.toContain('@prefix ob:');
    expect(turtle).not.toContain('@prefix pd:');
  });
});

describe('the view model', () => {
  const model = buildGraphModel(new Store(quads));
  const node = (id) => model.nodes.get(`urn:d3fend-graph:${id}`);

  it('shortens a DPV type to a curie instead of a full IRI', () => {
    expect(node('U').rdfType).toBe('eu-gdpr:DataSubject');
    expect(node('proc').rdfType).toBe('dpv:PersonalDataHandling');
  });

  it('classifies the privacy predicate', () => {
    expect(model.edges.find((e) => e.predicate === 'dpv:hasDataSubject').kind).toBe('privacy');
    expect(model.edges.find((e) => e.predicate === 'd3f:reads').kind).toBe('data-flow');
  });

  // Skipped until build-legal-metadata.py has run: legal-categories.json ships empty,
  // and every DPV node is then category-less and bucketed as 'other' by design.
  const projected = Object.keys(legalCategories).length > 0;

  it.skipIf(!projected)('folds DPV entities and data onto the D3FEND colours', () => {
    // Same concepts in another vocabulary, so they share a colour *and* a bucket —
    // which is the invariant rdf/nodeKind.js is built on.
    expect(node('U').coreCategory).toBe('Agent');
    expect(node('U').nodeKind).toBe('actors');
    expect(node('DB').nodeKind).toBe('artifacts');
  });

  it.skipIf(!projected)('gives a DPV-only family its own category and the legal bucket', () => {
    expect(node('proc').coreCategory).toBe('Process');
    expect(node('proc').nodeKind).toBe('legal');
  });

  it.skipIf(!projected)('prefers a D3FEND class over a DPV one on the same node', () => {
    // DB is both dpv:PersonalData (Data -> Artifact) and d3f:Database (Artifact);
    // either way it must be an artifact, and the d3f: branch is what decides.
    expect(node('DB').coreCategory).toBe('Artifact');
  });
});
