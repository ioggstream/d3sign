/**
 * Guards the vocabulary registry, which is what makes hover and completion work for
 * more than `d3f:` (docs/adr/0025-legal-knowledge-bases.md).
 *
 * Written so it passes whether or not app/scripts/build-legal-metadata.py has been
 * run: legal-completions.json ships empty, and a vocabulary with no terms is skipped
 * rather than contributing an empty completion section. The assertions that only make
 * sense with legal terms present therefore skip themselves.
 */

import { describe, it, expect } from 'vitest';
import {
  VOCABULARIES,
  qualify,
  splitQname,
  termOf,
  termTokenPattern,
  typingVocabularies,
  vocabularyFor,
} from '../src/editor/vocabularies.js';
import { termSections } from '../src/editor/d3fendHierarchy.js';
import { QUERY_GRAPH_PREFIXES } from '../src/query/queryPrefixes.js';
import { PREFIXES, TYPING_PREFIXES } from '../src/rdf/emit.js';

const legal = VOCABULARIES.filter((vocabulary) => vocabulary.prefix !== 'd3f');
const declared = { ...PREFIXES, ...QUERY_GRAPH_PREFIXES };

describe('the vocabulary registry', () => {
  it('always knows D3FEND', () => {
    expect(vocabularyFor('d3f')?.terms).toBeTruthy();
    expect(Object.keys(vocabularyFor('d3f').terms).length).toBeGreaterThan(1000);
  });

  it('registers no prefix a query could not name', () => {
    // The editor offering `dpv:` while the SPARQL preamble has no such prefix would
    // be an invitation to write a query that does not parse.
    for (const { prefix } of VOCABULARIES) {
      expect(declared, `${prefix}: is not a declared prefix`).toHaveProperty(prefix);
    }
  });

  it('gives every vocabulary a distinct prefix, label and rank', () => {
    const fields = ['prefix', 'label', 'rank'];
    for (const field of fields) {
      const values = VOCABULARIES.map((vocabulary) => vocabulary[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
    // D3FEND outranks the legal vocabularies: a diagram's tags mostly come from it.
    for (const vocabulary of legal) expect(vocabulary.rank).toBeGreaterThan(2);
  });

  it('skips a vocabulary the projection has no terms for', () => {
    for (const vocabulary of VOCABULARIES) {
      expect(Object.keys(vocabulary.terms).length, vocabulary.prefix).toBeGreaterThan(0);
    }
  });

  // The registry's `typing` flag documents which vocabularies a diagram may write, but
  // the parser and the emitter read TYPING_PREFIXES in rdf/emit.js — a literal, so that
  // they behave identically whether or not legal-completions.json has been built. Two
  // statements of one fact, so this fails if they drift
  // (docs/adr/0028-support-data-privacy-vocabulary.md).
  it('agrees with the parser about which vocabularies a diagram may write', () => {
    const flagged = typingVocabularies().map((vocabulary) => vocabulary.prefix);
    const registered = new Set(VOCABULARIES.map((vocabulary) => vocabulary.prefix));
    // TYPING_PREFIXES may name a vocabulary the projection has not loaded yet (`pd:`
    // before build-legal-kg.py ships the module), which is not a disagreement.
    expect(flagged.sort()).toEqual(TYPING_PREFIXES.filter((p) => registered.has(p)).sort());
  });

  it('never lets a judgement vocabulary type a node', () => {
    // The line ADR 0028 draws: `risk:` or `ob:` as a node type would both be a category
    // error and, since a writable prefix is consumed anywhere in a label, would strip
    // the label off `A[Cache risk:high]`.
    for (const prefix of ['risk', 'tech', 'eu-nis2', 'eu-aiact', 'ob', 'al']) {
      expect(TYPING_PREFIXES, prefix).not.toContain(prefix);
    }
  });
});

describe('qnames', () => {
  it('splits a qname and leaves a bare name unsplit', () => {
    expect(splitQname('dpv:EncryptionAtRest')).toEqual({ prefix: 'dpv', name: 'EncryptionAtRest' });
    expect(splitQname('d3f:AML.T0000')).toEqual({ prefix: 'd3f', name: 'AML.T0000' });
    expect(splitQname('Network')).toBeNull();
    expect(splitQname(undefined)).toBeNull();
  });

  it('qualifies a bare name and passes a qname through untouched', () => {
    expect(qualify('d3f', 'Network')).toBe('d3f:Network');
    expect(qualify('d3f', 'dpv:Encryption')).toBe('dpv:Encryption');
  });

  it('resolves a term only for a loaded vocabulary', () => {
    expect(termOf('d3f:Network')).toBeTruthy();
    expect(termOf('nosuch:Network')).toBeUndefined();
    expect(termOf('Network')).toBeUndefined();
  });
});

describe('the term token pattern', () => {
  const pattern = () => termTokenPattern();

  it('matches every registered prefix', () => {
    for (const { prefix, terms } of VOCABULARIES) {
      const [name] = Object.keys(terms);
      expect(`x ${prefix}:${name}`.match(pattern())).toContain(`${prefix}:${name}`);
    }
  });

  it('does not match an unregistered prefix', () => {
    expect('x nosuch:Thing'.match(pattern())).toBeNull();
  });

  it('does not fire inside a longer identifier or an IRI', () => {
    expect('notd3f:Network'.match(pattern())).toBeNull();
    // `urn:d3f:x` would be a phantom term inside a hand-edited IRI.
    expect('<urn:d3f:Network>'.match(pattern())).toBeNull();
  });
});

describe('the legal projection, once it has been built', () => {
  it.skipIf(!legal.length)('describes a legal term the same way it describes a D3FEND one', () => {
    const { prefix, terms } = legal[0];
    const [name] = Object.keys(terms);
    const sections = termSections(`${prefix}:${name}`);

    expect(sections.title).toBe(`${terms[name].label} (${prefix}:${name})`);
    expect(Array.isArray(sections.parents)).toBe(true);
    // Hand-authored vocabularies have nowhere to link to; DPV does.
    expect(sections.url === null || sections.url.startsWith('https://')).toBe(true);
  });

  it.skipIf(!legal.length)('qualifies a parent that crosses vocabularies', () => {
    // DPV's hierarchy leaves its module constantly (an eu-nis2 concept is
    // skos:broader a risk: one), so parents are stored as qnames there and must not
    // be re-qualified with the child's own prefix.
    for (const { prefix, terms } of legal) {
      for (const [name, item] of Object.entries(terms)) {
        for (const parent of termSections(`${prefix}:${name}`).parents) {
          expect(splitQname(parent), `${prefix}:${name} → ${parent}`).toBeTruthy();
          expect(parent).not.toMatch(/:.*:/);
        }
      }
    }
  });
});
