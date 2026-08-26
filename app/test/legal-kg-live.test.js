/**
 * Checks the hand-authored mappings against the *real* DPV, when it is present.
 *
 * This is the only guard against the failure this design is most exposed to: DPV 2.4
 * renames a concept, `al:legal-concept dpv:X` becomes a triple that joins with
 * nothing, and the symptom is a blank column in
 * 09-legal-coverage-of-document.rq and one fewer count in 11-dpv-measure-mix.rq.
 * Nothing errors. Nobody notices.
 *
 * Skipped rather than failed when app/public/kg/legal.ttl.gz has not been built, so a
 * fresh clone that has not run app/scripts/build-legal-kg.py still has a green suite
 * (docs/adr/0025-legal-knowledge-bases.md).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataFactory, Parser, Store } from 'n3';

const { namedNode } = DataFactory;
const kgDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/kg');
const legalFile = path.join(kgDir, 'legal.ttl.gz');
const present = existsSync(legalFile);

const AL = 'urn:d3fend-graph:align:';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';

let legal;
let regulation;

beforeAll(() => {
  if (!present) return;
  const parser = new Parser();
  legal = new Store(parser.parse(gunzipSync(readFileSync(legalFile)).toString('utf8')));
  regulation = new Store(new Parser().parse(readFileSync(path.join(kgDir, 'regulation.ttl'), 'utf8')));
});

describe.skipIf(!present)('the built legal knowledge base', () => {
  it('holds the vocabulary the manifest promises', () => {
    // The tripleHint on the `legal` entry is what the Sources chip shows before the
    // download; an order-of-magnitude drift means the module list changed.
    expect(legal.size).toBeGreaterThan(20000);
  });

  it('defines every concept the alignment points at', () => {
    const missing = regulation
      .getObjects(null, namedNode(`${AL}legal-concept`), null)
      .map((term) => term.value)
      .filter((iri) => !legal.getQuads(namedNode(iri), null, null, null).length);

    expect(missing, 'mappings pointing at concepts DPV no longer defines').toEqual([]);
  });

  it('defines every concept the obligations relate to', () => {
    const missing = regulation
      .getObjects(null, namedNode(`${SKOS}relatedMatch`), null)
      .map((term) => term.value)
      .filter((iri) => iri.startsWith('https://w3id.org/dpv'))
      .filter((iri) => !legal.getQuads(namedNode(iri), null, null, null).length);

    expect(missing, 'skos:relatedMatch targets DPV no longer defines').toEqual([]);
  });

  it('keeps the CC-BY attribution the modules carry', () => {
    // The build concatenates verbatim precisely so this survives; a future pruning
    // pass would delete it silently.
    const text = gunzipSync(readFileSync(legalFile)).toString('utf8');
    expect(text).toMatch(/CC-BY/i);
    expect(text).toMatch(/w3c\/dpv/);
  });

  it('states its relations directly, so the engine has nothing to materialise', () => {
    expect(legal.getQuads(null, namedNode('http://www.w3.org/2002/07/owl#onProperty'), null, null))
      .toHaveLength(0);
  });
});
