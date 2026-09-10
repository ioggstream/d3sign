import { describe, it, expect } from 'vitest';
import {
  alternativesBetween,
  getAncestors,
  isSubClassOf,
  relationsFor,
} from '../src/editor/d3fendRestrictions.js';
import d3fendMetadata from '../src/data/d3fend-metadata.json';

const describeRow = (row) => `${row.direction}/${row.tier} ${row.predicate} via ${row.via}`;

describe('getAncestors', () => {
  it('walks every parent, not just the first', () => {
    // d3f:WebServerApplication reaches d3f:Software through
    // d3f:ServiceApplication and d3f:Application; a first-parent-only walk (the
    // one getAncestorPath does) drops whichever branch it does not take, and 514
    // D3FEND classes have more than one parent.
    expect(getAncestors('WebServerApplication')).toEqual(
      expect.arrayContaining(['Application', 'ServiceApplication', 'Software', 'Artifact']),
    );
  });

  it('excludes the class itself unless asked', () => {
    expect(getAncestors('Software')).not.toContain('Software');
    expect(getAncestors('Software', { includeSelf: true })[0]).toBe('Software');
  });

  it('lists nearer ancestors before further ones', () => {
    const ancestors = getAncestors('WebServerApplication');
    expect(ancestors.indexOf('Application')).toBeLessThan(ancestors.indexOf('D3FENDCore'));
  });
});

describe('isSubClassOf', () => {
  it('is reflexive, like the * in rdfs:subClassOf*', () => {
    expect(isSubClassOf('Software', 'Software')).toBe(true);
  });

  it('follows the hierarchy in one direction only', () => {
    expect(isSubClassOf('WebServerApplication', 'Software')).toBe(true);
    expect(isSubClassOf('Software', 'WebServerApplication')).toBe(false);
  });
});

describe('relationsFor', () => {
  it('is the reported bug: the class states nothing of its own', () => {
    expect(d3fendMetadata.WebServerApplication.relations).toEqual([]);
  });

  it('inherits the relations its superclasses state', () => {
    const rows = relationsFor('WebServerApplication');
    expect(rows).not.toHaveLength(0);
    expect(rows.map((r) => `${r.predicate} ${r.targetLocalName} via ${r.via}`)).toEqual(
      expect.arrayContaining([
        'd3f:may-contain ApplicationConfiguration via Application',
        'd3f:contains ExecutableFile via Software',
        'd3f:implements Subroutine via Software',
        'd3f:instructs Process via Software',
      ]),
    );
  });

  it('names the ancestor that states the relation, and null for its own', () => {
    const rows = relationsFor('Software');
    expect(rows.filter((r) => r.via === null)).toHaveLength(d3fendMetadata.Software.relations.length);
    for (const row of rows.filter((r) => r.via !== null)) {
      expect(getAncestors('Software')).toContain(row.via);
    }
  });

  it('inherits the incoming relations too, not only the outgoing ones', () => {
    // 36 rows for a class that states none: 5 outgoing and 31 incoming. The
    // panel gets busier, which is the acknowledged cost of the fix.
    const rows = relationsFor('WebServerApplication');
    expect(rows.filter((r) => r.direction === 'out')).toHaveLength(5);
    expect(rows.filter((r) => r.direction === 'in').length).toBeGreaterThan(0);
  });

  it('opts out, so the raw projection stays reachable', () => {
    expect(relationsFor('WebServerApplication', { includeInherited: false })).toEqual([]);
  });

  it('keeps the nearest statement when a subclass restates a relation', () => {
    const rows = relationsFor('WebServerApplication');
    const keys = rows.map((r) => `${r.predicate}|${r.direction}|${r.targetLocalName}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('alternativesBetween', () => {
  // The measured cardinalities. They are small on purpose: constraining both
  // ends is what keeps the list readable, and the loose tier - every property
  // licensed on one end, up to 108 rows for d3f:SystemInitScript - is reached by
  // editing data/queries/15-alternative-links-between.rq, not from here.
  it('finds the property stated on a superclass', () => {
    expect(alternativesBetween('WebServerApplication', 'Process').map(describeRow)).toContain(
      'out/exact d3f:instructs via Software',
    );
  });

  it('finds the inverse-direction candidate the outgoing branch misses', () => {
    // d3f:instructed-by is stated on d3f:Process pointing back at d3f:Software,
    // so it is the same arrow written the other way round. Dropping the `in`
    // branch is exactly what this asserts against.
    const rows = alternativesBetween('WebServerApplication', 'Process');
    expect(rows.map(describeRow)).toEqual([
      'out/exact d3f:instructs via Software',
      'in/exact d3f:instructed-by via Process',
    ]);
  });

  it('tiers a filler below the drawn class as narrower', () => {
    expect(alternativesBetween('Process', 'File').map(describeRow)).toEqual([
      'out/exact d3f:uses via Process',
      'out/narrower d3f:process-image-path via Process',
    ]);
  });

  it('returns nothing when the ontology licenses nothing', () => {
    expect(alternativesBetween('UserAccount', 'File')).toEqual([]);
  });

  it('reports a property once when both branches find it', () => {
    // d3f:may-contain on d3f:File -> d3f:File is stated with the same class at
    // both ends, so it answers the outgoing and the incoming walk alike.
    const rows = alternativesBetween('SystemInitScript', 'File');
    expect(rows.map(describeRow)).toEqual(['out/exact d3f:may-contain via File']);
  });

  it('carries the inverse when one exists, and null when none does', () => {
    const [uses] = alternativesBetween('Process', 'File');
    expect(uses.predicate).toBe('d3f:uses');
    expect(uses.inverse).toBe('d3f:used-by');

    const [instructs] = alternativesBetween('WebServerApplication', 'Process');
    expect(instructs.inverse).toBe(null);
  });

  it('sorts outgoing before incoming and exact before narrower', () => {
    const rows = alternativesBetween('Process', 'Resource');
    const tiers = rows.map((r) => r.tier);
    expect(tiers.indexOf('narrower')).toBe(tiers.length - 1);
  });
});
