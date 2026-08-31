import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GRAPH_ID,
  NEIGHBOUR_GRAPH_BASE,
  mergeQuads,
  neighbourClasses,
  neighbourGraphName,
  neighbourInstanceIri,
  neighbourQuads,
  sanitizeGraphId,
} from '../src/rdf/neighbourGraph.js';
import { PREFIXES } from '../src/rdf/emit.js';
import { toTurtle } from '../src/rdf/serialize.js';
import d3fendCategories from '../src/data/d3fend-categories.json';

const targets = (localName) => neighbourClasses(localName).map((r) => r.targetLocalName);

describe('neighbourClasses', () => {
  it('keeps the peers of d3f:File', () => {
    expect(targets('File')).toEqual(expect.arrayContaining(['Email', 'Directory', 'FileSystem', 'FileSection']));
  });

  it('drops the classes in another top branch — that is the whole point', () => {
    // ContentFiltering and DecoyFile are related to File in the ontology, but they
    // are defensive techniques under the Plan branch. Query 01 is where those
    // belong; a neighbourhood is peers only.
    expect(d3fendCategories.File).toEqual(['Artifact']);
    expect(d3fendCategories.ContentFiltering).toEqual(['Plan']);
    expect(targets('File')).not.toContain('ContentFiltering');
    expect(targets('File')).not.toContain('DecoyFile');
  });

  it('drops the class itself, however the ontology relates it to itself', () => {
    // d3f:File d3f:may-contain d3f:File is true and useless here: minting an
    // instance of the class the node already is asserts nothing.
    expect(targets('File')).not.toContain('File');
  });

  it('keeps a class reached by two different properties as two rows, deduped exactly', () => {
    const rows = neighbourClasses('UserAccount').filter((r) => r.targetLocalName === 'UserToUserMessage');
    expect(rows.map((r) => r.predicate).sort()).toEqual(['d3f:has-recipient', 'd3f:has-sender']);
  });

  it('is sorted and stable, so a re-mint produces the same graph', () => {
    const once = neighbourClasses('UserAccount');
    expect(once).toEqual(neighbourClasses('UserAccount'));
    expect(once.map((r) => r.targetLocalName)).toEqual([...once.map((r) => r.targetLocalName)].sort());
  });

  it('returns nothing for a class with no same-branch neighbours', () => {
    expect(neighbourClasses('WebServerApplication')).toEqual([]);
  });

  it('returns nothing for a name the ontology does not place under D3FENDCore', () => {
    expect(neighbourClasses('NoSuchClassAnywhere')).toEqual([]);
  });
});

describe('neighbourQuads', () => {
  const GRAPH_ID = 'f';
  const subject = 'urn:d3fend-graph:f';
  const quads = neighbourQuads(subject, 'File', GRAPH_ID);
  const rdfType = `${PREFIXES.rdf}type`;
  const rdfsLabel = `${PREFIXES.rdfs}label`;

  it('puts everything in the named graph', () => {
    expect(neighbourGraphName(GRAPH_ID)).toBe(`${NEIGHBOUR_GRAPH_BASE}f`);
    expect(quads.every((q) => q.graph.value === neighbourGraphName(GRAPH_ID))).toBe(true);
  });

  it('mints one typed instance per neighbour class, not per relation', () => {
    const typeQuads = quads.filter((q) => q.predicate.value === rdfType);
    const classes = typeQuads.map((q) => q.object.value.slice(PREFIXES.d3f.length));
    expect(new Set(classes).size).toBe(classes.length);
    expect(classes.sort()).toEqual([...new Set(targets('File'))].sort());
  });

  it('names an instance after the graph and the class, so one graph holds one of each', () => {
    const email = neighbourInstanceIri(GRAPH_ID, 'Email');
    expect(email).toBe('urn:d3fend-graph:nbr:f-Email');
    expect(quads.some((q) => q.subject.value === email && q.predicate.value === rdfType)).toBe(true);
    // The source node is not in the key: another node added to graph `f` links to
    // this same Email rather than minting a second one.
    expect(neighbourInstanceIri('g', 'Email')).not.toBe(email);
  });

  it('labels each instance from the projection', () => {
    const label = quads.find(
      (q) => q.subject.value === neighbourInstanceIri(GRAPH_ID, 'Email') && q.predicate.value === rdfsLabel,
    );
    expect(label.object.termType).toBe('Literal');
    expect(label.object.value).toBe('Email');
  });

  it('orients the connecting triple the way the ontology states it', () => {
    // Directory d3f:may-contain File: the instance is the subject. Written the
    // other way round it is a different, false claim.
    const inward = neighbourClasses('File').find((r) => r.targetLocalName === 'Directory');
    expect(inward.direction).toBe('in');
    const predicate = `${PREFIXES.d3f}may-contain`;
    expect(
      quads.some(
        (q) =>
          q.subject.value === neighbourInstanceIri(GRAPH_ID, 'Directory') &&
          q.predicate.value === predicate &&
          q.object.value === subject,
      ),
    ).toBe(true);

    // File d3f:contains FileSection: the node is the subject.
    const outward = neighbourClasses('File').find((r) => r.targetLocalName === 'FileSection');
    expect(outward.direction).toBe('out');
    expect(
      quads.some(
        (q) =>
          q.subject.value === subject &&
          q.predicate.value === `${PREFIXES.d3f}contains` &&
          q.object.value === neighbourInstanceIri(GRAPH_ID, 'FileSection'),
      ),
    ).toBe(true);
  });

  it('expands the CURIE predicates, since a quad holds IRIs', () => {
    expect(quads.every((q) => q.predicate.value.startsWith('http'))).toBe(true);
  });

  it('is deterministic, which is what lets a merge deduplicate a re-mint away', () => {
    const again = neighbourQuads(subject, 'File', GRAPH_ID);
    expect(again.map(String)).toEqual(quads.map(String));
  });

  it('returns nothing for a class with no neighbours, so the caller can decline', () => {
    expect(neighbourQuads('urn:d3fend-graph:w', 'WebServerApplication', 'w')).toEqual([]);
  });
});

describe('sanitizeGraphId', () => {
  it('keeps what n3 can abbreviate and drops the rest', () => {
    expect(sanitizeGraphId('db')).toBe('db');
    expect(sanitizeGraphId('my graph 2')).toBe('mygraph2');
    expect(sanitizeGraphId('a/b:c')).toBe('abc');
  });

  it('rewrites a dot rather than dropping it, so an ATT&CK id stays readable', () => {
    expect(sanitizeGraphId('T1110.001')).toBe('T1110_001');
  });

  it('falls back rather than minting a graph with no local name', () => {
    expect(sanitizeGraphId('')).toBe(DEFAULT_GRAPH_ID);
    expect(sanitizeGraphId(null)).toBe(DEFAULT_GRAPH_ID);
    expect(sanitizeGraphId('///')).toBe(DEFAULT_GRAPH_ID);
    expect(sanitizeGraphId('-x-')).toBe('x');
  });
});

describe('mergeQuads', () => {
  const file = neighbourQuads('urn:d3fend-graph:f', 'File', 'shared');
  const account = neighbourQuads('urn:d3fend-graph:u', 'UserAccount', 'shared');

  it('adds a second node to the graph without touching what is there', () => {
    const merged = mergeQuads(file, account);
    expect(merged.added).toBe(account.length);
    expect(merged.quads).toHaveLength(file.length + account.length);
  });

  it('makes re-minting the same node a no-op', () => {
    const merged = mergeQuads(file, neighbourQuads('urn:d3fend-graph:f', 'File', 'shared'));
    expect(merged.added).toBe(0);
    expect(merged.quads).toHaveLength(file.length);
  });

  it('shares an instance two nodes both neighbour instead of duplicating it', () => {
    // Both File and Directory neighbour d3f:FileSystem in the Artifact branch, so
    // the second node contributes its own link but not a second FileSystem. This is
    // the reason the graph id is prompted for at all.
    const directory = neighbourQuads('urn:d3fend-graph:d', 'Directory', 'shared');
    const fileSystem = neighbourInstanceIri('shared', 'FileSystem');
    const typeOf = (qs) =>
      qs.filter((q) => q.subject.value === fileSystem && q.predicate.value === `${PREFIXES.rdf}type`);
    expect(typeOf(file)).toHaveLength(1);
    expect(typeOf(directory)).toHaveLength(1);

    const merged = mergeQuads(file, directory);
    expect(typeOf(merged.quads)).toHaveLength(1);
    expect(merged.added).toBeLessThan(directory.length);
  });

  it('starts from nothing when the graph is new', () => {
    expect(mergeQuads(undefined, account).added).toBe(account.length);
  });
});

describe('the TriG a minted graph serializes to', () => {
  it('abbreviates every minted IRI through N:', async () => {
    // The regression this exists for: an instance IRI n3 cannot fit into
    // [_a-zA-Z0-9][-_a-zA-Z0-9]* is silently written out in full, and the pane
    // fills with <urn:d3fend-graph:nbr:…>. Only serializing catches it.
    const text = await toTurtle(neighbourQuads('urn:d3fend-graph:db', 'Database', 'db'));
    expect(text).toContain('@prefix N: <urn:d3fend-graph:nbr:>');
    expect(text).toContain('N:db {');
    expect(text).toContain('N:db-DatabaseQuery');
    expect(text).not.toContain('<urn:d3fend-graph:nbr:');
  });

  it('declares no N: prefix in a document that mints nothing', async () => {
    const text = await toTurtle([]);
    expect(text).not.toContain('@prefix N:');
  });
});
