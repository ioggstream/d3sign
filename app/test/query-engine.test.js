/**
 * Real SPARQL, no Worker, no 3.6 MB ontology.
 *
 * `createQueryEngine` takes the oxigraph module as an argument precisely so this
 * file can hand it the node build and drive the engine directly. The fixture below
 * is a miniature D3FEND: enough hierarchy to prove `rdfs:subClassOf*` works, which
 * is the whole reason for querying the ontology instead of the precomputed JSON.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createQueryEngine } from '../src/query/queryEngine.js';
import { resultTable } from '../src/query/resultModel.js';
import { queryPrefixes, withPreamble } from '../src/query/queryPrefixes.js';
import { kgGraphName } from '../src/rdf/knowledgeBases.js';

const KG = kgGraphName('fixture');
const DOC = 'urn:d3fend-graph:current';

const ONTOLOGY = `
@prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

d3f:Credential rdfs:subClassOf d3f:DigitalArtifact ; rdfs:label "Credential" .
d3f:Password rdfs:subClassOf d3f:Credential ; rdfs:label "Password" .
d3f:DigitalArtifact rdfs:subClassOf d3f:Artifact ; rdfs:label "Digital Artifact" .

d3f:CredentialScrubbing d3f:hardens d3f:Credential ; rdfs:label "Credential Scrubbing" ;
  d3f:d3fend-id "D3-CS" .
d3f:MultiFactorAuthentication d3f:hardens d3f:Credential ; rdfs:label "Multi-factor Authentication" .

# The shape that broke the canned queries: d3fend.ttl states many relations *only*
# as an OWL existential restriction, never as a direct triple (d3f:preceded-by has
# 115 of these and no direct form at all). The engine flattens them at load.
d3f:CredentialRotation rdfs:label "Credential Rotation" ;
  rdfs:subClassOf d3f:DefensiveTechnique ,
    [ a owl:Restriction ; owl:onProperty d3f:hardens ; owl:someValuesFrom d3f:Credential ] .
`;

// One diagram: a password store nobody hardens, and a host that is hardened.
const DOCUMENT = `
<urn:d3fend-graph:pw-store> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://d3fend.mitre.org/ontologies/d3fend.owl#Password> <${DOC}> .
<urn:d3fend-graph:pw-store> <http://www.w3.org/2000/01/rdf-schema#label> "Password store" <${DOC}> .
<urn:d3fend-graph:host-1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://d3fend.mitre.org/ontologies/d3fend.owl#Host> <${DOC}> .
`;

let oxigraph;
let engine;
const prefixes = queryPrefixes([]);
const run = (sparql) => engine.query(withPreamble(sparql, prefixes));

beforeAll(async () => {
  oxigraph = await import('oxigraph');
  engine = createQueryEngine(oxigraph);
  engine.loadTurtle(KG, ONTOLOGY);
  engine.syncGraphs([DOC], DOCUMENT);
});

describe('createQueryEngine', () => {
  it('reports the triples it loaded per graph', () => {
    expect(engine.loadedGraphs()[KG]).toBeGreaterThan(5);
  });

  it('flattens an OWL restriction into the direct triple queries look for', () => {
    const result = run('SELECT ?measure WHERE { GRAPH ?g { ?measure d3f:hardens d3f:Credential } }');
    const measures = result.rows.map((r) => r.measure.value.split('#')[1]).sort();
    // CredentialRotation states this relation *only* as a restriction, so without
    // materialization it would be absent and the answer would look complete.
    expect(measures).toEqual(['CredentialRotation', 'CredentialScrubbing', 'MultiFactorAuthentication']);
  });

  it('counts what it inferred, so the Sources chip can show it', () => {
    const fresh = createQueryEngine(oxigraph);
    const { triples, inferred } = fresh.loadTurtle(kgGraphName('tmp'), ONTOLOGY);
    expect(inferred).toBe(1);
    expect(triples).toBeGreaterThan(inferred);
  });

  it('does not invent a relation from a restriction with a blank target', () => {
    const fresh = createQueryEngine(oxigraph);
    const graph = kgGraphName('blank');
    fresh.loadTurtle(
      graph,
      `@prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
       @prefix owl: <http://www.w3.org/2002/07/owl#> .
       @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
       d3f:X rdfs:subClassOf [ a owl:Restriction ; owl:onProperty d3f:hardens ;
         owl:someValuesFrom [ a owl:Restriction ; owl:onProperty d3f:reads ] ] .`,
    );
    // Its own preamble: this engine is a fresh one, not the shared `run` helper's.
    const rows = fresh.query(
      withPreamble(`SELECT ?o WHERE { GRAPH <${graph}> { d3f:X d3f:hardens ?o } }`, prefixes),
    );
    expect(rows.rows).toEqual([]);
  });

  it('queries the document and the ontology together', () => {
    const result = run(`
      SELECT ?node ?measure WHERE {
        GRAPH <${DOC}> { ?node a ?class }
        GRAPH <${KG}> { ?class rdfs:subClassOf* ?super . ?measure d3f:hardens ?super }
      }
    `);
    const measures = result.rows.map((r) => r.measure.value).sort();
    // Password -> Credential is the transitive step the JSON projection cannot make.
    // CredentialRotation only reaches Credential through the materialized restriction.
    expect(measures).toEqual([
      'http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialRotation',
      'http://d3fend.mitre.org/ontologies/d3fend.owl#CredentialScrubbing',
      'http://d3fend.mitre.org/ontologies/d3fend.owl#MultiFactorAuthentication',
    ]);
    expect(result.rows.every((r) => r.node.value === 'urn:d3fend-graph:pw-store')).toBe(true);
  });

  it('keeps declared variable order, and a column that is unbound in every row', () => {
    const result = run(`SELECT ?node ?missing WHERE { GRAPH <${DOC}> { ?node a ?t } }`);
    expect(result.vars).toEqual(['node', 'missing']);
    const table = resultTable(result, { prefixes });
    expect(table.columns).toEqual(['node', 'missing']);
    expect(table.rows.every((row) => row[1].text === '')).toBe(true);
  });

  it('names an aggregate column by its alias', () => {
    const result = run(`SELECT (COUNT(?s) AS ?total) WHERE { GRAPH <${DOC}> { ?s ?p ?o } }`);
    expect(result.vars).toEqual(['total']);
    expect(Number(result.rows[0].total.value)).toBeGreaterThan(0);
  });

  it('resolves SELECT * from the bindings', () => {
    const result = run(`SELECT * WHERE { GRAPH <${DOC}> { <urn:d3fend-graph:host-1> ?p ?o } }`);
    expect(result.vars.sort()).toEqual(['o', 'p']);
  });

  it('returns ASK as a boolean', () => {
    expect(run(`ASK { GRAPH <${DOC}> { ?s a d3f:Password } }`)).toMatchObject({
      kind: 'ask',
      boolean: true,
    });
    expect(run(`ASK { GRAPH <${DOC}> { ?s a d3f:PrivateKey } }`).boolean).toBe(false);
  });

  it('returns CONSTRUCT as quads, and an empty CONSTRUCT as construct not select', () => {
    const built = run(`
      CONSTRUCT { ?node d3f:hardened-by ?measure }
      WHERE {
        GRAPH <${DOC}> { ?node a ?class }
        GRAPH <${KG}> { ?class rdfs:subClassOf* ?s . ?measure d3f:hardens ?s }
      }
    `);
    expect(built.kind).toBe('construct');
    // The three measures that harden Credential; host-1 collects none.
    expect(built.quads.length).toBe(3);
    expect(built.quads[0].predicate.value).toContain('hardened-by');

    // Empty because nothing states that predicate — not because the pattern is
    // outside a GRAPH block, which now matches the union of every loaded graph.
    expect(run('CONSTRUCT { ?s ?p ?o } WHERE { ?s d3f:no-such-predicate ?o }')).toMatchObject({
      kind: 'construct',
      quads: [],
    });
  });

  it('finds artifacts with no defensive measure — the flagship question', () => {
    const result = run(`
      SELECT ?node WHERE {
        GRAPH <${DOC}> { ?node a ?class }
        FILTER NOT EXISTS {
          GRAPH <${KG}> { ?class rdfs:subClassOf* ?super . ?m d3f:hardens ?super }
        }
      }
    `);
    expect(result.rows.map((r) => r.node.value)).toEqual(['urn:d3fend-graph:host-1']);
  });

  it('catches a d3f: class the ontology does not define', () => {
    const result = run(`
      SELECT ?class WHERE {
        GRAPH <${DOC}> { ?node a ?class }
        FILTER(STRSTARTS(STR(?class), STR(d3f:)))
        FILTER NOT EXISTS { GRAPH <${KG}> { ?class rdfs:subClassOf ?any } }
      }
    `);
    // Host is used in the diagram but absent from this fixture ontology.
    expect(result.rows.map((r) => r.class.value)).toEqual([
      'http://d3fend.mitre.org/ontologies/d3fend.owl#Host',
    ]);
  });

  it('flattens literals with their language and datatype', () => {
    const result = run(`SELECT ?label WHERE { GRAPH <${DOC}> { ?s rdfs:label ?label } }`);
    expect(result.rows[0].label).toMatchObject({ termType: 'Literal', value: 'Password store' });
  });

  it('caps rows and admits it', () => {
    const result = engine.query('SELECT ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }', { maxRows: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('replaces a document graph rather than accumulating into it', () => {
    engine.syncGraphs(
      [DOC],
      `<urn:d3fend-graph:only> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://d3fend.mitre.org/ontologies/d3fend.owl#Host> <${DOC}> .`,
    );
    const result = run(`SELECT ?s WHERE { GRAPH <${DOC}> { ?s a ?t } }`);
    expect(result.rows.map((r) => r.s.value)).toEqual(['urn:d3fend-graph:only']);
    // Put the fixture back for any later test.
    engine.syncGraphs([DOC], DOCUMENT);
  });

  it('leaves the knowledge base alone when document graphs are synced', () => {
    engine.syncGraphs([DOC], DOCUMENT);
    expect(engine.loadedGraphs()[KG]).toBeGreaterThan(5);
  });

  it('reports a syntax error with a position', () => {
    expect(() => engine.query('SELECT ?s WHERE { ?s ?p')).toThrow();
  });
});

/**
 * The union default graph.
 *
 * Every triple this app loads lands in a named graph, so without the union a
 * query written the way SPARQL is usually taught returns zero rows — which reads
 * as "no findings" rather than as a mistake.
 */
describe('a pattern outside any GRAPH block', () => {
  const countOf = (result) => Number(result.rows[0].n.value);

  it('sees the document and the knowledge base at once', () => {
    const all = countOf(run('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }'));
    const doc = countOf(run(`SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${DOC}> { ?s ?p ?o } }`));
    const kg = countOf(run(`SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${KG}> { ?s ?p ?o } }`));
    expect(doc).toBeGreaterThan(0);
    expect(kg).toBeGreaterThan(0);
    expect(all).toBe(doc + kg);
  });

  it('answers ASK and CONSTRUCT the same way', () => {
    expect(run('ASK { ?s a d3f:Password }').boolean).toBe(true);
    const built = run('CONSTRUCT { ?s a d3f:Password } WHERE { ?s a d3f:Password }');
    expect(built.quads).toHaveLength(1);
  });

  it('walks a property path across the graph boundary', () => {
    const result = run(`
      SELECT ?measure WHERE {
        ?node a ?class .
        ?class rdfs:subClassOf* ?super .
        ?measure d3f:hardens ?super
      }
    `);
    // pw-store is a Password in the document; the chain to Credential and on to
    // its measures lives in the ontology graph.
    const measures = [...new Set(result.rows.map((r) => r.measure.value.split('#')[1]))].sort();
    expect(measures).toEqual(['CredentialRotation', 'CredentialScrubbing', 'MultiFactorAuthentication']);
  });

  it('still binds ?g inside a GRAPH block, so the canned queries are untouched', () => {
    const result = run('SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }');
    expect(result.rows.map((r) => r.g.value).sort()).toEqual([KG, DOC].sort());
  });
});

describe('a query that declares its own dataset', () => {
  it('keeps the graphs its FROM names and nothing else', () => {
    const scoped = run(`SELECT ?s FROM <${DOC}> WHERE { ?s a ?class }`);
    expect(scoped.rows.map((r) => r.s.value).sort()).toEqual([
      'urn:d3fend-graph:host-1',
      'urn:d3fend-graph:pw-store',
    ]);
  });

  it('is not fooled by the word FROM inside a literal or a comment', () => {
    // Both of these are generic queries: the union stays on.
    const inLiteral = run('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o FILTER(STR(?o) != "FROM <x>") }');
    const inComment = run('# not FROM anywhere\nSELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }');
    expect(Number(inLiteral.rows[0].n.value)).toBeGreaterThan(0);
    expect(Number(inComment.rows[0].n.value)).toBeGreaterThan(0);
  });
});
