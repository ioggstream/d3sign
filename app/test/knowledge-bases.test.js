/**
 * Guards the knowledge-base manifest and the query preamble it feeds.
 *
 * These are the two places a knowledge base can be wrong without any code failing:
 * an id the auto-loader's regex cannot match, a url pointing at a file nobody
 * produced, or a prefix label bound to two different IRIs — all of which surface
 * only as a query that quietly returns nothing.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_BASES, kgGraphName, knowledgeBaseById } from '../src/rdf/knowledgeBases.js';
import { QUERY_GRAPH_PREFIXES, queryPrefixes } from '../src/query/queryPrefixes.js';
import { PREFIXES } from '../src/rdf/emit.js';

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ids = KNOWLEDGE_BASES.map((kb) => kb.id);

describe('the knowledge-base manifest', () => {
  it('has unique ids the auto-loader can match', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // referencedSources() finds a base by scanning for K:<id>, so an id outside
      // this charset is unreachable from a query no matter what the manifest says.
      expect(id, id).toMatch(/^[\w-]+$/);
      expect(knowledgeBaseById(id).id).toBe(id);
    }
  });

  it.each(ids)('%s loads into its own named graph', (id) => {
    expect(knowledgeBaseById(id).graph).toBe(kgGraphName(id));
  });

  it.each(ids)('%s points somewhere under app/public/kg/', (id) => {
    expect(knowledgeBaseById(id).url).toMatch(/^kg\//);
  });

  it.each(ids)('%s is committed, or is a build artifact that says how to make it', (id) => {
    const { url, missingHint } = knowledgeBaseById(id);
    const exists = existsSync(path.join(appDir, 'public', url));
    if (exists) return;
    // A gzipped base is produced by a script and may legitimately be absent in a
    // fresh clone that has not run it. A plain one is hand-authored and committed, so
    // its absence is a broken manifest.
    expect(url.endsWith('.gz'), `${url} is missing and is not a build artifact`).toBe(true);
    expect(missingHint, `${url} is missing and nothing says how to produce it`).toBeTruthy();
  });

  it.each(ids)('%s declares a label, a description and a triple estimate', (id) => {
    const kb = knowledgeBaseById(id);
    expect(kb.label.length).toBeGreaterThan(0);
    expect(kb.description.length).toBeGreaterThan(0);
    // sourcesPanel formats this before the fetch; undefined renders as "~undefined".
    expect(kb.tripleHint).toBeGreaterThan(0);
  });

  it('says how to produce every base that is not committed as plain text', () => {
    for (const kb of KNOWLEDGE_BASES) {
      if (kb.url.endsWith('.gz')) expect(kb.missingHint, kb.id).toBeTruthy();
    }
  });

  it('leaves prefixes to the preamble', () => {
    // A base's own `prefixes` are merged only once it is loaded, which would make a
    // query parse or fail depending on which checkboxes are ticked.
    for (const kb of KNOWLEDGE_BASES) expect(kb.prefixes, kb.id).toBeUndefined();
  });
});

describe('the query preamble', () => {
  const all = queryPrefixes();

  it('declares every prefix unconditionally, with no knowledge base loaded', () => {
    for (const label of Object.keys(QUERY_GRAPH_PREFIXES)) {
      expect(all[label]).toBe(QUERY_GRAPH_PREFIXES[label]);
    }
    for (const label of ['dpv', 'pd', 'eu-nis2', 'eu-gdpr', 'eu-aiact', 'skos', 'dct', 'ob', 'al']) {
      expect(all, `${label} must not depend on a source being ticked`).toHaveProperty(label);
    }
  });

  it('uses labels SPARQL accepts', () => {
    for (const [label, iri] of Object.entries(all)) {
      expect(label, label).toMatch(/^[A-Za-z][\w-]*$/);
      expect(iri, label).toMatch(/[#/:]$/);
    }
  });

  it('binds no label to two different IRIs', () => {
    for (const [label, iri] of Object.entries(QUERY_GRAPH_PREFIXES)) {
      if (label in PREFIXES) expect(PREFIXES[label], label).toBe(iri);
    }
  });
});
