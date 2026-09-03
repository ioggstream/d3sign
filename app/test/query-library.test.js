/**
 * Guards the shipped .rq files rather than the loader.
 *
 * `import.meta.glob` is a Vite transform, so the library module itself is not
 * importable under plain vitest-node; the files are read from disk here instead,
 * through the same `parseQueryDoc` the loader uses. That keeps the thing actually
 * worth asserting — that every query declares what it is and what it needs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQueryDoc } from '../src/query/resultModel.js';
import { KNOWLEDGE_BASES } from '../src/rdf/knowledgeBases.js';

const dir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/queries');
const fileNames = readdirSync(dir).filter((name) => name.endsWith('.rq')).sort();
const queries = fileNames.map((name) => ({
  name,
  ...parseQueryDoc(readFileSync(path.join(dir, name), 'utf8'), name),
}));
const kbIds = new Set(KNOWLEDGE_BASES.map((kb) => kb.id));

describe('the canned query library', () => {
  it('ships queries', () => {
    expect(queries.length).toBeGreaterThan(0);
  });

  it.each(fileNames)('%s declares a title and a description', (name) => {
    const query = queries.find((q) => q.name === name);
    expect(query.title.length).toBeGreaterThan(0);
    // The title must be declared, not defaulted from the file name.
    expect(query.title).not.toBe(name.replace(/\.rq$/, ''));
    expect(query.about.length).toBeGreaterThan(0);
  });

  it.each(fileNames)('%s only needs knowledge bases the manifest defines', (name) => {
    const query = queries.find((q) => q.name === name);
    for (const need of query.needs) expect(kbIds).toContain(need);
  });

  it.each(fileNames)('%s is one of the four query forms', (name) => {
    const query = queries.find((q) => q.name === name);
    expect(query.sparql).toMatch(/\b(SELECT|CONSTRUCT|DESCRIBE|ASK)\b/);
  });

  it.each(fileNames)('%s declares no prefixes, since the pane injects them', (name) => {
    const query = queries.find((q) => q.name === name);
    expect(query.sparql).not.toMatch(/^\s*PREFIX\b/im);
  });

  it('marks exactly the ?this queries as selection-scoped', () => {
    for (const query of queries) {
      expect(query.needsSelection).toBe(/\?this\b/.test(query.sparql));
    }
  });

  it('leaves a pair-scoped query parseable with its placeholders in', () => {
    // A pair-scoped query is opened from an edge's info panel, which substitutes
    // the two classes. Picked from the library instead it runs unsubstituted, so
    // the placeholders have to be legal prefixed names rather than variables -
    // binding them through VALUES is what defeats oxigraph's planner.
    for (const query of queries.filter((q) => q.scope === 'pair')) {
      expect(query.sparql, query.name).toContain('d3f:SourceClass');
      expect(query.sparql, query.name).toContain('d3f:TargetClass');
      expect(query.sparql, query.name).not.toMatch(/\bVALUES\b/);
      // A pair has no selected node, so the picker must not ask for one.
      expect(query.needsSelection, query.name).toBe(false);
    }
  });

  it('has at least one selection-scoped query and one CONSTRUCT', () => {
    expect(queries.some((q) => q.needsSelection)).toBe(true);
    expect(queries.some((q) => /\bCONSTRUCT\b/.test(q.sparql))).toBe(true);
  });

  it('declares exactly the knowledge bases it references, no more', () => {
    for (const query of queries) {
      // K:<id> is the only way a query can reach a knowledge base, and the pane
      // auto-loads from the text rather than from `needs:`. So an under-declared
      // `needs:` lies to the picker, and an over-declared one makes the pane
      // download a knowledge base the query never reads.
      const referenced = [...query.sparql.matchAll(/\bK:([\w-]+)\b/g)].map((m) => m[1]);
      expect([...new Set(query.needs)].sort(), query.name).toEqual([...new Set(referenced)].sort());
    }
  });
});
