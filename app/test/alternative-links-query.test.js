/**
 * The alternatives list computed twice, and held to one answer.
 *
 * `alternativesBetween` walks the precomputed JSON because the panel is
 * synchronous and the ontology is a lazy 400 KB fetch;
 * 15-alternative-links-between.rq asks the same question of the real graph. Two
 * implementations of one question drift, and the symptom is a panel that
 * disagrees with the query button next to it — so the real ontology is loaded
 * here and both are run against it.
 *
 * Skipped rather than failed when app/public/kg/d3fend.ttl.gz is absent, so a
 * fresh clone that has not built the knowledge bases still has a green suite
 * (the same arrangement as legal-kg-live.test.js).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';
import { createQueryEngine } from '../src/query/queryEngine.js';
import { bindClassPair, PAIR_PLACEHOLDERS, resultTable } from '../src/query/resultModel.js';
import { queryPrefixes, withPreamble } from '../src/query/queryPrefixes.js';
import { kgGraphName } from '../src/rdf/knowledgeBases.js';
import { alternativesBetween } from '../src/editor/d3fendRestrictions.js';

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ontologyFile = path.join(appDir, 'public/kg/d3fend.ttl.gz');
const present = existsSync(ontologyFile);
const querySparql = readFileSync(
  path.join(appDir, 'src/data/queries/15-alternative-links-between.rq'),
  'utf8',
);

const D3FEND = kgGraphName('d3fend');
const prefixes = queryPrefixes([]);

let engine;

beforeAll(() => {
  if (!present) return;
  engine = createQueryEngine(oxigraph);
  // loadTurtle flattens the OWL restrictions on the way in, which is exactly the
  // step the query relies on rather than repeating.
  engine.loadTurtle(D3FEND, gunzipSync(readFileSync(ontologyFile)).toString('utf8'));
}, 120_000);

/**
 * The query's rows as `direction/tier predicate via -> filler`.
 *
 * The filler is part of the key, not decoration: `d3f:accesses` is stated on
 * `d3f:NetworkResourceAccess` twice with two different far ends, so a row string
 * without it collapses two candidates into one and hides a real disagreement.
 */
function sparqlRows(source, target) {
  const sparql = bindClassPair(querySparql, { source, target });
  const table = resultTable(engine.query(withPreamble(sparql, prefixes)), { prefixes });
  const at = (row, name) => row[table.columns.indexOf(name)]?.text ?? '';
  // termCell quotes a literal and CURIEs an IRI, and the `1-`/`2-` prefixes exist
  // only so SPARQL's ORDER BY puts outgoing and exact first. None of that is part
  // of what the two implementations agree on.
  const literal = (value) => value.replace(/^"|"$/g, '').replace(/^\d-/, '');
  const bare = (name) => (row) => at(row, name).replace(/^d3f:/, '');
  return table.rows.map(
    (row) =>
      `${literal(at(row, 'direction'))}/${literal(at(row, 'tier'))} ` +
      `${at(row, 'property')} via ${bare('via')(row)} -> ${bare('filler')(row)}`,
  );
}

/** The same, from the JSON walk the panel actually uses. */
function jsRows(source, target) {
  return alternativesBetween(source, target).map(
    (row) => `${row.direction}/${row.tier} ${row.predicate} via ${row.via} -> ${row.filler}`,
  );
}

describe('15-alternative-links-between.rq', () => {
  it('leaves the placeholders as valid, matchable-in-principle class names', () => {
    // Picked from the library the query runs unsubstituted, so it has to parse.
    // It matches nothing, which is why main.js says so in the status line.
    expect(querySparql).toContain(PAIR_PLACEHOLDERS.source);
    expect(querySparql).toContain(PAIR_PLACEHOLDERS.target);
  });

  it('substitutes both ends, everywhere they appear', () => {
    const bound = bindClassPair(querySparql, { source: 'Process', target: 'File' });
    expect(bound).not.toContain(PAIR_PLACEHOLDERS.source);
    expect(bound).not.toContain(PAIR_PLACEHOLDERS.target);
    // Both branches name both classes, so a replace-first would leave half.
    expect(bound.match(/d3f:Process\b/g).length).toBeGreaterThan(1);
    expect(bound.match(/d3f:File\b/g).length).toBeGreaterThan(1);
  });

  it('leaves the query alone when a class is missing', () => {
    expect(bindClassPair(querySparql, { source: 'Process' })).toBe(querySparql);
    expect(bindClassPair(querySparql, {})).toBe(querySparql);
  });

  it('does not bind the classes through VALUES', () => {
    // A variable inside rdfs:subClassOf* defeats oxigraph's planner: the same
    // query took over two minutes unfinished when the pair arrived through a
    // trailing VALUES clause, and is instant with the classes written in.
    expect(querySparql).not.toMatch(/\bVALUES\b/);
  });

  it('does not decide the tier with EXISTS', () => {
    // BIND(IF(EXISTS {...})) does not correlate ?filler here - it labelled every
    // row exact, including d3f:contains d3f:ProcessImage for a d3f:File target.
    expect(querySparql).not.toMatch(/\bEXISTS\b/);
  });

  it('guards the open predicate against labels and annotations', () => {
    expect(querySparql).toMatch(/\?property\s+rdfs:subPropertyOf\*\s+d3f:d3fend-object-property/);
  });

  it('groups so one axiom is one row, whichever branch found it', () => {
    // A bare SELECT DISTINCT splits on ?direction, so a property with the same
    // class at both ends comes back twice with opposite arrows - which is one
    // axiom, not two alternatives.
    expect(querySparql).toMatch(/GROUP BY \?property \?via \?filler/);
  });

  it('excludes the metadata predicates the projection excludes', () => {
    // d3f:enables is technique -> tactic and drives the kill-chain badges; it is
    // not a link anyone draws. The panel never sees these, so neither can the
    // query, or the two disagree.
    expect(querySparql).toMatch(/FILTER\(\?property NOT IN \(/);
    expect(querySparql).toContain('d3f:enables');
    expect(querySparql).toContain('d3f:weakness-of');
  });

  it('excludes a root filler, which would match every pair', () => {
    // d3f:D3FENDCore as the far end is an "alternative" between any two nodes at
    // all. It is also the only filler of d3f:dependent and d3f:provider, which
    // is why the projection has neither.
    expect(querySparql).toMatch(/\?filler rdfs:subClassOf\+ d3f:D3FENDCore/);
  });
});

describe.skipIf(!present)('the query and the panel agree', () => {
  // The pairs that made the two implementations worth cross-checking: a relation
  // reachable only through a superclass, one reachable only backwards, a
  // narrower filler, a self-referential property both branches find, and a pair
  // the ontology licenses nothing for.
  const pairs = [
    ['WebServerApplication', 'Process'],
    ['Process', 'File'],
    ['SystemInitScript', 'File'],
    ['UserAccount', 'File'],
    ['Process', 'Resource'],
    ['Browser', 'Process'],
    // The four that caught a real divergence. The first two reach a metadata
    // predicate (d3f:enables, d3f:weakness-of), the third reaches d3f:dependent
    // and d3f:provider whose only filler is the root, and the last has two
    // candidates sharing a predicate and differing only in filler.
    ['DefensiveTactic', 'DefensiveTechnique'],
    ['CWE-78', 'UserInputFunction'],
    ['DataExchangeMapping', 'DataDependency'],
    ['NetworkResourceAccess', 'NetworkFileShareResource'],
  ];

  it.each(pairs)('%s -> %s', (source, target) => {
    expect(sparqlRows(source, target).sort()).toEqual(jsRows(source, target).sort());
  });

  it('finds the relation stated on a superclass', () => {
    expect(jsRows('WebServerApplication', 'Process')).toContain(
      'out/exact d3f:instructs via Software -> Process',
    );
  });

  it('finds the one stated backwards on the other end', () => {
    expect(jsRows('WebServerApplication', 'Process')).toContain(
      'in/exact d3f:instructed-by via Process -> Software',
    );
  });
});
