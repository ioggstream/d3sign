import { describe, it, expect } from 'vitest';
import { hierarchyText, termSections } from '../src/editor/d3fendHierarchy.js';

// `termSections` is what the hover card draws (via renderD3fendCard) and what
// `hierarchyText` flattens for the completion popup. Asserted here rather than
// through the DOM: the suite has no DOM env, and the contract worth protecting
// is the content, not the markup.
//
// Terms are addressed by qname — "d3f:Network", not "Network" — because a local name
// is only unique inside one vocabulary (editor/vocabularies.js).
describe('termSections', () => {
  it('describes a class with its title, link, path and relations', () => {
    const s = termSections('d3f:Network');

    expect(s.title).toBe('Network (d3f:Network)');
    expect(s.url).toBe('https://d3fend.mitre.org/dao/d3f:Network');
    expect(s.documentation).toMatch(/^A network is a group of computers/);
    expect(s.path.at(-1)).toBe('Digital Information Bearer');
    expect(s.parents).toEqual(['d3f:DigitalInformationBearer']);
    expect(s.children).toContain('d3f:LocalAreaNetwork');
    expect(s.inverseOf).toBe(null);
  });

  it('appends the characteristic marker to a property definition', () => {
    expect(termSections('d3f:contains').documentation).toMatch(/\(T\)$/);
    expect(termSections('d3f:communicates-with').documentation).toMatch(/\(S\)$/);
  });

  // The citation on a DPV term comes from a blank node that build-legal-metadata.py
  // dereferences into {label, url} (ADR 0025). Skips itself when the projection has
  // not been built, like vocabularies.test.js does.
  it('carries the dereferenced citation of a legal term, never a blank-node id', () => {
    const s = termSections('dpv:Acquire');
    if (!s) return;

    expect(s.documentation).toBe('to come into possession or control of the data');
    expect(s.documentation).not.toMatch(/\bn[0-9a-f]{20,}/);
    expect(s.sources).toEqual([
      { label: 'GDPR Art.4-2', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/art_4/par_2/oj' },
    ]);
    expect(hierarchyText('dpv:Acquire')).toContain('Source: GDPR Art.4-2');
  });

  it('has no sources for a vocabulary that cites nothing per term', () => {
    expect(termSections('d3f:Network').sources).toEqual([]);
  });

  it('reports the inverse of a property, qualified', () => {
    expect(termSections('d3f:accessed-by').inverseOf).toBe('d3f:accesses');
  });

  it('is undefined for a name outside every vocabulary', () => {
    expect(termSections('d3f:NotAThing')).toBeUndefined();
    // A bare local name is no longer an identity, and must not silently resolve.
    expect(termSections('Network')).toBeUndefined();
    // A prefix no vocabulary is loaded for is a miss, not a crash.
    expect(termSections('nosuch:Thing')).toBeUndefined();
  });
});

describe('hierarchyText', () => {
  it('states each section once, in card order', () => {
    const text = hierarchyText('d3f:Network');

    expect(text.match(/Path:/g)).toHaveLength(1);
    expect(text.match(/Parents:/g)).toHaveLength(1);
    expect(text.match(/Children:/g)).toHaveLength(1);
    expect(text.indexOf('Path:')).toBeLessThan(text.indexOf('Parents:'));
    expect(text).toContain('Parents: d3f:DigitalInformationBearer');
  });

  it('omits the sections a term has nothing to say about', () => {
    expect(hierarchyText('d3f:Network')).not.toContain('Inverse:');
  });

  it('is undefined for a name outside every vocabulary', () => {
    expect(hierarchyText('d3f:NotAThing')).toBeUndefined();
  });
});
