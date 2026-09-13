/**
 * The two platform checks, run against the example that documents them.
 *
 * Both queries are read off disk and run verbatim, so a syntax error fails here
 * rather than when a human clicks it, and the example cannot drift from the
 * answers its own prose promises (docs/adr/0034-platform-topology-and-location.md).
 *
 * The document is built by parsing multi-site-platform.md through the real
 * parser and emitter rather than by hand-writing quads: what is under test is
 * whether the *mermaid convention* — nested d3f:PhysicalLocation and d3f:Host
 * subgraphs, a shared application node — produces a graph these queries can
 * read. Hand-written quads would test the queries against an idealised shape the
 * diagram might not actually emit.
 *
 * K:d3fend is a miniature fixture: 16-application-site-coverage.rq resolves
 * `?appClass rdfs:subClassOf* d3f:Application`, and what that has to get right is
 * that d3f:DatabaseApplication counts and d3f:ApplicationProcess does not.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQueryEngine } from '../src/query/queryEngine.js';
import { queryPrefixes, withPreamble } from '../src/query/queryPrefixes.js';
import { kgGraphName } from '../src/rdf/knowledgeBases.js';
import { parseDocument } from '../src/parser/document.js';
import { collectTaggedIds, emitQuads, nodeIri } from '../src/rdf/emit.js';
import { toNQuads } from '../src/rdf/serialize.js';

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const queryFile = (name) => readFileSync(path.join(appDir, 'src/data/queries', name), 'utf8');
const exampleFile = (name) => readFileSync(path.join(appDir, 'src/data/examples', name), 'utf8');

const D3FEND = kgGraphName('d3fend');

// Enough of the Application branch to exercise the transitive step, plus the
// Process branch that must stay out of it. rdfs:subClassOf* is reflexive, so
// d3f:Application would match itself with no triples at all — the subclasses are
// what make the difference between resolving the hierarchy and not.
const ONTOLOGY = `
@prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

d3f:Application rdfs:subClassOf d3f:Software .
d3f:ServiceApplication rdfs:subClassOf d3f:Application .
d3f:DatabaseApplication rdfs:subClassOf d3f:Application .
d3f:WebApplication rdfs:subClassOf d3f:Application .

d3f:Process rdfs:subClassOf d3f:DigitalInformationBearer .
d3f:UserProcess rdfs:subClassOf d3f:Process .
d3f:ApplicationProcess rdfs:subClassOf d3f:UserProcess .
d3f:ServiceApplicationProcess rdfs:subClassOf d3f:ApplicationProcess .
d3f:DatabaseService rdfs:subClassOf d3f:ServiceApplicationProcess .

d3f:Host rdfs:subClassOf d3f:ComputerNetworkNode .
d3f:PhysicalLocation rdfs:subClassOf d3f:D3FENDCore .

# The flattened owl:Restrictions the worker writes on load (ADR 0020) — class-level
# d3f:contains and d3f:runs, the same predicates the queries walk. They are here as
# the adversarial case: a query whose d3f:contains+ escapes the document graphs
# starts walking the ontology instead of the platform.
d3f:Host d3f:contains d3f:Application .
d3f:ApplicationProcess d3f:runs d3f:Application .
d3f:Server d3f:runs d3f:ServiceApplication .
`;

/** Every mermaid block of a markdown example, as n-quads in its own named graph. */
async function documentQuads(markdown) {
  const { diagrams } = parseDocument(markdown);
  // Like main.js: the example wires `m1-web` in a block that does not type it, and an
  // endpoint typed nowhere the emitter can see is not a resource, so its link is not
  // written. Tagged-ness is a fact about the document (ADR 0003).
  const taggedIds = collectTaggedIds(diagrams);
  const quads = diagrams.flatMap(
    ({ ast, diagramId }) => emitQuads(ast, diagramId, { taggedIds }).quads,
  );
  const graphNames = [...new Set(diagrams.map((d) => `urn:d3fend-graph:${d.diagramId}`))];
  return { nquads: await toNQuads(quads), graphNames };
}

const prefixes = queryPrefixes([]);

let engine;
const run = (sparql) => engine.query(withPreamble(sparql, prefixes));
const rowsOf = (result) => result.rows.map((row) => Object.fromEntries(
  Object.entries(row).map(([name, term]) => [name, term?.value]),
));

beforeAll(async () => {
  const oxigraph = await import('oxigraph');
  engine = createQueryEngine(oxigraph);
  engine.loadTurtle(D3FEND, ONTOLOGY);
  const { nquads, graphNames } = await documentQuads(exampleFile('multi-site-platform.md'));
  engine.syncGraphs(graphNames, nquads);
});

describe('the example emits the topology the convention describes', () => {
  it('nests the process under its host under its site', () => {
    // Two d3f:contains hops and no shortcut: the whole reason the queries write
    // `d3f:contains+` rather than a single step.
    const result = run(`
      SELECT ?mid WHERE {
        GRAPH ?g {
          <${nodeIri('milan')}> d3f:contains ?mid .
          ?mid d3f:contains <${nodeIri('m1-web')}> .
        }
      }`);
    expect(rowsOf(result).map((r) => r.mid)).toEqual([nodeIri('m1')]);
  });

  it('fans two processes into one application node', () => {
    const result = run(`
      SELECT ?proc WHERE { GRAPH ?g { ?proc d3f:runs <${nodeIri('checkout')}> } }`);
    expect(rowsOf(result).map((r) => r.proc).sort()).toEqual(
      [nodeIri('m1-web'), nodeIri('r1-web')].sort(),
    );
  });

  it('keeps the shared application node outside every site', () => {
    // Inside a site box it would assert the single-site fact the model exists to
    // disprove — and the coverage query would then find it in exactly one site.
    const result = run(`
      ASK { GRAPH ?g { ?loc a d3f:PhysicalLocation ; d3f:contains+ <${nodeIri('checkout')}> } }`);
    expect(result.kind).toBe('ask');
    expect(result.boolean).toBe(false);
  });
});

describe('16-application-site-coverage.rq', () => {
  const sparql = queryFile('16-application-site-coverage.rq');

  it('reports the application that exists in one site only', () => {
    const rows = rowsOf(run(sparql));
    const orders = rows.find((row) => row.app === nodeIri('orders'));
    expect(orders).toBeTruthy();
    expect(orders.sites).toBe('1');
    expect(orders.where).toBe('Milan');
  });

  it('does not report the application deployed in both', () => {
    expect(rowsOf(run(sparql)).map((row) => row.app)).not.toContain(nodeIri('checkout'));
  });

  it('does not mistake a deployment for a service', () => {
    // d3f:DatabaseService is a d3f:ServiceApplicationProcess, so the postgres
    // process must not appear as an application with a site count of its own.
    expect(rowsOf(run(sparql)).map((row) => row.app)).not.toContain(nodeIri('m2-db'));
  });

  it('reports an application nothing runs, rather than dropping it', () => {
    // The inner-join bug: the likeliest single point of failure is the service
    // deployed nowhere, and it is the one row a non-OPTIONAL query loses.
    const orphan = 'urn:d3fend-graph:orphan';
    engine.syncGraphs(['urn:d3fend-graph:orphan-doc'], [
      `<${orphan}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>`,
      ` <http://d3fend.mitre.org/ontologies/d3fend.owl#ServiceApplication>`,
      ` <urn:d3fend-graph:orphan-doc> .`,
    ].join(''));
    try {
      const row = rowsOf(run(sparql)).find((r) => r.app === orphan);
      expect(row).toBeTruthy();
      expect(row.sites).toBe('0');
    } finally {
      engine.dropGraph('urn:d3fend-graph:orphan-doc');
    }
  });
});

describe('17-dependency-locality.rq', () => {
  const sparql = queryFile('17-dependency-locality.rq');

  it('finds the dependency the site has not got', () => {
    const rows = rowsOf(run(sparql));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      site: 'Rome',
      app: nodeIri('checkout'),
      missing: nodeIri('orders'),
      missingLabel: 'Orders',
    });
  });

  it('says nothing about the site that has it', () => {
    // Milan runs both, so the check that matters is that a satisfied requirement
    // is silent — a query listing every dependency would pass the test above too.
    expect(rowsOf(run(sparql)).map((row) => row.site)).not.toContain('Milan');
  });
});
