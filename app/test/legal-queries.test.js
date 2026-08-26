/**
 * The shipped legal queries, run for real against the real regulation.ttl.
 *
 * Two things are being guarded, and neither shows up in a unit test of anything
 * smaller. First, that the gap query is genuinely a left join: the likeliest bug in
 * a compliance query is one that can only ever list duties you have already met, and
 * it looks identical to a working one until you have data with a real gap in it.
 * Second, DPV's mixed hierarchy — skos:broader inside a family, rdfs:subClassOf at
 * the top — which a "simplification" to a bare skos:broader* would break silently.
 *
 * The .rq files are read off disk and run verbatim, so a syntax error in one of them
 * fails here rather than when a human clicks it. K:d3fend and K:legal are miniature
 * fixtures; K:regulation is the committed file, because the mappings are the data
 * under test (docs/adr/0025-legal-knowledge-bases.md).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQueryEngine } from '../src/query/queryEngine.js';
import { bindSelection } from '../src/query/resultModel.js';
import { queryPrefixes, withPreamble } from '../src/query/queryPrefixes.js';
import { kgGraphName } from '../src/rdf/knowledgeBases.js';

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const queryFile = (name) => readFileSync(path.join(appDir, 'src/data/queries', name), 'utf8');

const D3FEND = kgGraphName('d3fend');
const REGULATION = kgGraphName('regulation');
const LEGAL = kgGraphName('legal');
const DOC = 'urn:d3fend-graph:current';

// Enough D3FEND to exercise the transitive step. rdfs:subClassOf* is reflexive, so a
// class needs no triple at all to match itself — the subclasses here are what make
// the difference between a query that resolves the hierarchy and one that does not.
const ONTOLOGY = `
@prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

d3f:FileEncryption rdfs:subClassOf d3f:DefensiveTechnique ; rdfs:label "File Encryption" .
d3f:Multi-factorAuthentication rdfs:subClassOf d3f:DefensiveTechnique ; rdfs:label "Multi-factor Authentication" .
d3f:CredentialScrubbing rdfs:subClassOf d3f:DefensiveTechnique ; rdfs:label "Credential Scrubbing" .

# A class the alignment does not mention, sitting *under* one it does: a document
# node typed with this must still count as covering the mapped duty.
d3f:TransparentFileEncryption rdfs:subClassOf d3f:FileEncryption ; rdfs:label "Transparent File Encryption" .
`;

// A miniature DPV, reproducing the shape that matters: skos:broader up the family,
// rdfs:subClassOf at the top, and a concept typed with its own family (DPV puns
// class-as-type).
const LEGAL_VOCAB = `
@prefix dpv: <https://w3id.org/dpv#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

dpv:TechnicalOrganisationalMeasure a rdfs:Class ; skos:prefLabel "Technical and Organisational Measure"@en .
dpv:TechnicalMeasure rdfs:subClassOf dpv:TechnicalOrganisationalMeasure ; skos:prefLabel "Technical Measure"@en .
dpv:OrganisationalMeasure rdfs:subClassOf dpv:TechnicalOrganisationalMeasure ; skos:prefLabel "Organisational Measure"@en .
dpv:LegalMeasure rdfs:subClassOf dpv:TechnicalOrganisationalMeasure ; skos:prefLabel "Legal Measure"@en .
dpv:PhysicalMeasure rdfs:subClassOf dpv:TechnicalOrganisationalMeasure ; skos:prefLabel "Physical Measure"@en .

dpv:CryptographicMethods a rdfs:Class, dpv:TechnicalMeasure ; skos:broader dpv:TechnicalMeasure ;
  skos:prefLabel "Cryptographic Methods"@en .
dpv:Encryption skos:broader dpv:CryptographicMethods ; skos:prefLabel "Encryption"@en .
dpv:EncryptionAtRest skos:broader dpv:Encryption ; skos:prefLabel "Encryption at Rest"@en .
dpv:MultiFactorAuthentication skos:broader dpv:TechnicalMeasure ; skos:prefLabel "Multi-Factor Authentication"@en .
`;

// One diagram: file encryption via a *subclass* of the mapped class, and a defensive
// measure the alignment has no opinion about.
const DOCUMENT = [
  `<urn:d3fend-graph:tde> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://d3fend.mitre.org/ontologies/d3fend.owl#TransparentFileEncryption> <${DOC}> .`,
  `<urn:d3fend-graph:tde> <http://www.w3.org/2000/01/rdf-schema#label> "Transparent DB encryption" <${DOC}> .`,
  `<urn:d3fend-graph:scrub> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialScrubbing> <${DOC}> .`,
  `<urn:d3fend-graph:scrub> <http://www.w3.org/2000/01/rdf-schema#label> "Scrub creds from logs" <${DOC}> .`,
].join('\n');

const OB = 'urn:d3fend-graph:obl:';
const AL = 'urn:d3fend-graph:align:';

let oxigraph;
let engine;
let loaded;
const prefixes = queryPrefixes([]);
const run = (sparql) => engine.query(withPreamble(sparql, prefixes));
const values = (result, name) => result.rows.map((row) => row[name]?.value);

beforeAll(async () => {
  oxigraph = await import('oxigraph');
  engine = createQueryEngine(oxigraph);
  engine.loadTurtle(D3FEND, ONTOLOGY);
  loaded = engine.loadTurtle(REGULATION, readFileSync(path.join(appDir, 'public/kg/regulation.ttl'), 'utf8'));
  engine.loadTurtle(LEGAL, LEGAL_VOCAB);
  engine.syncGraphs([DOC], DOCUMENT);
});

describe('loading the hand-authored knowledge base', () => {
  it('parses in the engine that will actually hold it', () => {
    expect(loaded.triples).toBeGreaterThan(100);
  });

  it('has nothing for the restriction materializer to do', () => {
    // DPV and this file state their relations directly, so the Sources chip should
    // report `inferred: 0` and the extra UPDATE pass is a known no-op rather than a
    // silent source of triples nobody wrote.
    expect(loaded.inferred).toBe(0);
    expect(engine.loadTurtle(kgGraphName('tmp'), LEGAL_VOCAB).inferred).toBe(0);
  });
});

describe('08-obligations-without-measure.rq', () => {
  const sparql = queryFile('08-obligations-without-measure.rq');

  it('lists a duty nothing in the document addresses', () => {
    const gaps = values(run(sparql), 'obligation');
    // Staff training: mapped to nothing, because D3FEND has no technique for it.
    // A query built outwards from the diagram could not produce this row at all.
    expect(gaps).toContain(`${OB}nis2-art21-2-g`);
  });

  it('does not list a duty the document covers through a subclass', () => {
    const gaps = values(run(sparql), 'obligation');
    // The diagram draws d3f:TransparentFileEncryption; the alignment maps
    // d3f:FileEncryption. Without rdfs:subClassOf* this would appear as a gap.
    expect(gaps).not.toContain(`${OB}gdpr-art32-1-a`);
  });

  it('names every gap with its citation, not just its IRI', () => {
    const result = run(sparql);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.citation?.value, row.obligation?.value).toBeTruthy();
      expect(row.label?.value, row.obligation?.value).toBeTruthy();
    }
  });
});

describe('09-legal-coverage-of-document.rq', () => {
  const sparql = queryFile('09-legal-coverage-of-document.rq');

  it('reports the covering node, the article and the reasoning', () => {
    const result = run(sparql);
    const rows = result.rows.filter((row) => row.node.value === 'urn:d3fend-graph:tde');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.citation.value).toMatch(/Article/);
      expect(row.strength.value.startsWith(AL)).toBe(true);
      // The rationale is what makes the row auditable rather than a green tick.
      expect(row.rationale?.value.length).toBeGreaterThan(20);
    }
  });

  it('is the exact complement of the gap query', () => {
    const covered = new Set(
      run(sparql).rows.map((row) => row.citation.value),
    );
    const gaps = values(run(queryFile('08-obligations-without-measure.rq')), 'citation');
    for (const citation of gaps) expect(covered).not.toContain(citation);
  });
});

describe('10-legal-duties-for-selected.rq', () => {
  const sparql = queryFile('10-legal-duties-for-selected.rq');

  it('resolves a selected node through the class hierarchy', () => {
    const result = run(bindSelection(sparql, 'urn:d3fend-graph:tde'));
    expect(result.rows.length).toBeGreaterThan(0);
    expect(values(result, 'citation').some((c) => c.includes('32(1)(a)'))).toBe(true);
  });

  it('returns nothing for a node the alignment has no opinion about', () => {
    expect(run(bindSelection(sparql, 'urn:d3fend-graph:scrub')).rows).toHaveLength(0);
  });
});

describe('11-dpv-measure-mix.rq', () => {
  const sparql = queryFile('11-dpv-measure-mix.rq');

  it('lists every family, including the ones with nothing in them', () => {
    const result = run(sparql);
    expect(values(result, 'familyLabel').sort()).toEqual([
      'Legal Measure',
      'Organisational Measure',
      'Physical Measure',
      'Technical Measure',
    ]);
  });

  it('counts the document into the family its mapped concept belongs to', () => {
    const byFamily = Object.fromEntries(
      run(sparql).rows.map((row) => [row.familyLabel.value, Number(row.nodes.value)]),
    );
    // dpv:EncryptionAtRest → Encryption → CryptographicMethods → TechnicalMeasure.
    expect(byFamily['Technical Measure']).toBeGreaterThan(0);
    expect(byFamily['Physical Measure']).toBe(0);
  });
});

describe("DPV's mixed hierarchy", () => {
  const walk = (path_) => `
    SELECT ?c WHERE { GRAPH K:legal { ?c ${path_} dpv:TechnicalOrganisationalMeasure } }
  `;

  it('needs the rdfs:subClassOf alternation to reach the top of a family', () => {
    // The trap this documents: leaf concepts use skos:broader, but
    // dpv:TechnicalMeasure reaches its parent by rdfs:subClassOf. A bare
    // skos:broader* stops one hop short and under-reports without ever failing.
    const withAlternation = values(run(walk('(skos:broader|rdfs:subClassOf)*')), 'c');
    const broaderOnly = values(run(walk('skos:broader*')), 'c');

    expect(withAlternation).toContain('https://w3id.org/dpv#EncryptionAtRest');
    expect(broaderOnly).not.toContain('https://w3id.org/dpv#EncryptionAtRest');
    expect(withAlternation.length).toBeGreaterThan(broaderOnly.length);
  });

  it('cannot be walked once it is split across two named graphs', () => {
    // Why every DPV module ships in one graph. A property path is evaluated inside
    // one GRAPH binding, so splitting the vocabulary truncates the walk and returns
    // a shorter, plausible-looking answer rather than an error.
    const split = createQueryEngine(oxigraph);
    const [top, rest] = [
      LEGAL_VOCAB.slice(0, LEGAL_VOCAB.indexOf('dpv:CryptographicMethods')),
      `@prefix dpv: <https://w3id.org/dpv#> .
       @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
       ${LEGAL_VOCAB.slice(LEGAL_VOCAB.indexOf('dpv:CryptographicMethods'))}`,
    ];
    split.loadTurtle(LEGAL, top);
    split.loadTurtle(kgGraphName('legal-extension'), rest);

    const rows = split.query(withPreamble(walk('(skos:broader|rdfs:subClassOf)*'), prefixes)).rows;
    expect(rows.map((row) => row.c.value)).not.toContain('https://w3id.org/dpv#EncryptionAtRest');
  });
});

describe('12-unmapped-measures.rq', () => {
  it('finds the drawn measure the alignment says nothing about', () => {
    const result = run(queryFile('12-unmapped-measures.rq'));
    const nodes = values(result, 'node');
    expect(nodes).toContain('urn:d3fend-graph:scrub');
    // The covered one is not a gap in the alignment, whichever way the hierarchy runs.
    expect(nodes).not.toContain('urn:d3fend-graph:tde');
  });
});

describe('13-enrich-legal-obligations.rq', () => {
  it('constructs labelled obligation nodes the graph view can draw', () => {
    const result = run(queryFile('13-enrich-legal-obligations.rq'));
    expect(result.kind).toBe('construct');

    const satisfies = result.quads.filter((q) => q.predicate.value === `${AL}satisfies`);
    expect(satisfies.length).toBeGreaterThan(0);
    expect(satisfies.every((q) => q.object.value.startsWith(OB))).toBe(true);

    // Without the label the obligation is drawn as a bare urn:, since ob:/al: are
    // deliberately absent from the document prefix set.
    const labels = result.quads.filter(
      (q) => q.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#label',
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((q) => /Article/.test(q.object.value))).toBe(true);
  });
});
