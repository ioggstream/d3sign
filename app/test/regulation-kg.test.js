/**
 * Guards app/public/kg/regulation.ttl, the only RDF in this project written by hand.
 *
 * Everything asserted here is a way the file can be wrong without anything failing:
 * a mapping against a D3FEND class that does not exist, an obligation nothing
 * defines, a skos:broader pointing out of the graph. All of them surface as a query
 * that quietly returns fewer rows — which reads as "you are compliant" and is the
 * worst possible lie for this feature (docs/adr/0025-legal-knowledge-bases.md).
 *
 * n3, not oxigraph: this is about what the file says, not about querying it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataFactory, Parser, Store } from 'n3';
import d3fendCompletions from '../src/data/d3fend-completions.json';
import { QUERY_GRAPH_PREFIXES } from '../src/query/queryPrefixes.js';

const OB = 'urn:d3fend-graph:obl:';
const AL = 'urn:d3fend-graph:align:';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const DCT = 'http://purl.org/dc/terms/';
const D3F = 'http://d3fend.mitre.org/ontologies/d3fend.owl#';

const file = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../public/kg/regulation.ttl',
);

const { namedNode } = DataFactory;
const store = new Store(new Parser().parse(readFileSync(file, 'utf8')));

// n3's accessors drop the position they are named after: getSubjects(p, o, g),
// getObjects(s, p, g). Terms rather than raw IRI strings, as elsewhere in the app.
const subjectsOf = (predicate, object) =>
  store.getSubjects(namedNode(predicate), namedNode(object), null).map((term) => term.value);
const objectsOf = (subject, predicate) =>
  store.getObjects(namedNode(subject), namedNode(predicate), null).map((term) => term.value);

const obligations = subjectsOf(`${RDF}type`, `${OB}Obligation`);
const mappings = subjectsOf(`${RDF}type`, `${AL}Mapping`);
const STRENGTHS = new Set([`${AL}Full`, `${AL}Partial`, `${AL}Supporting`]);
const REVIEW_STATES = new Set([`${AL}Draft`, `${AL}Reviewed`]);

// The DPV namespaces the preamble declares. A legal-concept outside them is either a
// typo or a vocabulary no query can name.
//
// Read off the preamble rather than listed by hand: a hand-written label the map no
// longer has resolves to `undefined`, which weakens this guard silently instead of
// failing — which is exactly what happened when `gdpr:` became `eu-gdpr:`.
const dpvNamespaces = Object.values(QUERY_GRAPH_PREFIXES).filter((namespace) =>
  namespace.startsWith('https://w3id.org/dpv'),
);

describe('regulation.ttl — the obligation catalogue', () => {
  it('parses and holds obligations from more than one instrument', () => {
    expect(obligations.length).toBeGreaterThan(10);
    expect(new Set(subjectsOf(`${RDF}type`, `${OB}Instrument`)).size).toBeGreaterThan(1);
  });

  it.each(obligations)('%s is labelled, cited and attributed to an instrument', (obligation) => {
    expect(objectsOf(obligation, `${SKOS}prefLabel`)).toHaveLength(1);
    // The citation is what a reader recognises; without it a row is an opaque urn:.
    expect(objectsOf(obligation, `${DCT}source`)).toHaveLength(1);
    expect(objectsOf(obligation, `${OB}instrument`)).toHaveLength(1);
  });

  it('keeps its hierarchy inside this graph', () => {
    // A property path is evaluated inside one GRAPH binding, so a skos:broader
    // leaving K:regulation cannot be walked at all.
    const defined = new Set(obligations);
    for (const obligation of obligations) {
      for (const parent of objectsOf(obligation, `${SKOS}broader`)) {
        expect(defined, `${obligation} is broader ${parent}`).toContain(parent);
      }
    }
  });

  it('links out to DPV one hop at a time, and only to declared namespaces', () => {
    for (const target of store.getObjects(null, namedNode(`${SKOS}relatedMatch`), null)) {
      const known = dpvNamespaces.some((ns) => target.value.startsWith(ns));
      expect(known, `${target.value} is in no declared namespace`).toBe(true);
    }
  });
});

describe('regulation.ttl — the D3FEND alignment', () => {
  it('ships mappings', () => {
    expect(mappings.length).toBeGreaterThan(5);
  });

  it.each(mappings)('%s claims exactly one D3FEND class', (mapping) => {
    expect(objectsOf(mapping, `${AL}d3fend-class`)).toHaveLength(1);
  });

  it.each(mappings)('%s names a D3FEND class that exists', (mapping) => {
    for (const iri of objectsOf(mapping, `${AL}d3fend-class`)) {
      expect(iri.startsWith(D3F), `${iri} is not a d3f: term`).toBe(true);
      // Checked against the completion projection rather than the 3.6 MB ontology:
      // it is the same source of truth the editor uses, and it catches a rename.
      expect(d3fendCompletions, iri).toHaveProperty(iri.slice(D3F.length));
    }
  });

  it.each(mappings)('%s says what it covers and how completely', (mapping) => {
    const obligations_ = objectsOf(mapping, `${AL}obligation`);
    const concepts = objectsOf(mapping, `${AL}legal-concept`);
    // A mapping to neither a duty nor a legal concept asserts nothing.
    expect(obligations_.length + concepts.length).toBeGreaterThan(0);

    const strength = objectsOf(mapping, `${AL}strength`);
    expect(strength).toHaveLength(1);
    expect(STRENGTHS).toContain(strength[0]);
  });

  it.each(mappings)('%s explains itself', (mapping) => {
    // Mandatory: an unexplained coverage claim cannot be audited or argued with.
    const rationale = objectsOf(mapping, `${AL}rationale`);
    expect(rationale).toHaveLength(1);
    expect(rationale[0].length).toBeGreaterThan(20);

    const status = objectsOf(mapping, `${AL}review-status`);
    expect(status).toHaveLength(1);
    expect(REVIEW_STATES).toContain(status[0]);
  });

  it('maps only obligations this file defines', () => {
    const defined = new Set(obligations);
    for (const mapping of mappings) {
      for (const obligation of objectsOf(mapping, `${AL}obligation`)) {
        expect(defined, `${mapping} maps ${obligation}`).toContain(obligation);
      }
    }
  });

  it('maps only into declared legal namespaces', () => {
    for (const mapping of mappings) {
      for (const concept of objectsOf(mapping, `${AL}legal-concept`)) {
        const known = dpvNamespaces.some((ns) => concept.startsWith(ns));
        expect(known, `${concept} is in no declared namespace`).toBe(true);
      }
    }
  });

  it('leaves at least one obligation deliberately uncovered', () => {
    // Not pedantry: a catalogue where every duty is mapped makes the gap query
    // untestable against real data, and D3FEND genuinely has no technique for, say,
    // staff training. The fixture for that case is the file itself.
    const covered = new Set(mappings.flatMap((m) => objectsOf(m, `${AL}obligation`)));
    expect(obligations.some((obligation) => !covered.has(obligation))).toBe(true);
  });
});
