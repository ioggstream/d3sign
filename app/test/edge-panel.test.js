import { describe, it, expect } from 'vitest';
import { alternativeBadges, edgePanelSummary } from '../src/viz/edgePanel.js';

const G = 'urn:d3fend-graph:';

const edge = (over = {}) => ({
  id: `${G}a->${G}b:d3f:reads`,
  predicate: 'd3f:reads',
  label: 'd3f:reads',
  kind: 'data-flow',
  source: `${G}a`,
  target: `${G}b`,
  invertible: true,
  ...over,
});

describe('edgePanelSummary', () => {
  it('names the relation and both ends, shortened as the drawing shortens them', () => {
    expect(edgePanelSummary(edge())).toMatchObject({
      drawn: 'd3f:reads',
      written: 'd3f:reads',
      flipped: false,
      kind: 'data-flow',
      source: 'a',
      target: 'b',
      derived: false,
      standsFor: [],
    });
  });

  it('reads the D3FEND definition of the predicate out of the ontology', () => {
    expect(edgePanelSummary(edge()).definition).toContain('x reads y');
  });

  it('spots a flipped drawing by the drawn and written names disagreeing', () => {
    // No filter state is consulted: `label` is what is drawn and `predicate` is
    // always the CURIE as written, so the two disagreeing *is* the flip.
    const flipped = edgePanelSummary(edge({ label: 'd3f:read-by', source: `${G}b`, target: `${G}a` }));
    expect(flipped).toMatchObject({ drawn: 'd3f:read-by', written: 'd3f:reads', flipped: true });
  });

  it('defines the written predicate even while the drawing is inverted', () => {
    // The inverse names come from rdf/inverse-map.json and are display labels the
    // ontology need not define — d3f:read-by is not a D3FEND property — so looking
    // the drawn one up would find nothing.
    const flipped = edgePanelSummary(edge({ label: 'd3f:read-by' }));
    expect(flipped.definition).toContain('x reads y');
  });

  it('leaves the definition null for a predicate outside d3f:', () => {
    expect(edgePanelSummary(edge({ predicate: 'ex:mine', label: 'ex:mine' })).definition).toBe(null);
  });

  it('keeps the fold count off the predicate name', () => {
    // The ×N belongs to the fold and is reported as a count, so the title stays the
    // name of a relation.
    const folded = edgePanelSummary(
      edge({ label: 'd3f:reads ×2', derived: true, foldedCount: 2, foldedFrom: [`${G}a1`, `${G}a2`], foldedTo: [`${G}b`] }),
    );
    expect(folded.drawn).toBe('d3f:reads');
    expect(folded.flipped).toBe(false);
    expect(folded.foldedCount).toBe(2);
  });

  it('expands a folded edge into the child links it stands for', () => {
    // What toCytoscape recorded so the collapse would not be lossy; nothing read it
    // back until this panel.
    const folded = edgePanelSummary(
      edge({
        source: `${G}box`,
        label: 'd3f:reads ×2',
        derived: true,
        foldedCount: 2,
        foldedFrom: [`${G}a1`, `${G}a2`],
        foldedTo: [`${G}b`],
      }),
    );
    expect(folded.standsFor).toEqual([
      { source: 'a1', target: 'b' },
      { source: 'a2', target: 'b' },
    ]);
  });

  it('reports a link asserted both ways, which the drawing only says with a second head', () => {
    const both = edgePanelSummary(
      edge({ predicate: 'd3f:connected-to', label: 'd3f:connected-to', bidirectional: true }),
    );
    expect(both).toMatchObject({ bidirectional: true, flipped: false, source: 'a', target: 'b' });
  });

  it('lists both directions of a folded two-way link', () => {
    const both = edgePanelSummary(
      edge({
        source: `${G}box`,
        predicate: 'd3f:connected-to',
        label: 'd3f:connected-to ×2',
        derived: true,
        bidirectional: true,
        foldedCount: 2,
        foldedFrom: [`${G}a1`],
        foldedTo: [`${G}b`],
      }),
    );
    expect(both.standsFor).toEqual([
      { source: 'a1', target: 'b' },
      { source: 'b', target: 'a1' },
    ]);
  });

  describe('a collapsed artifact path', () => {
    const collapsed = (over = {}) =>
      edge({
        id: `${G}client->${G}api:payload:HTTP request`,
        predicate: `collapsed:${G}request`,
        label: 'HTTP request',
        source: `${G}client`,
        target: `${G}api`,
        invertible: false,
        derived: true,
        collapsed: true,
        foldedCount: 1,
        payload: `${G}request`,
        payloadLabel: 'HTTP request',
        standsFor: [
          { from: `${G}client`, predicate: 'd3f:produces', to: `${G}request` },
          { from: `${G}api`, predicate: 'd3f:executes', to: `${G}request` },
        ],
        ...over,
      });

    it('is titled with the payload and is never reported as flipped', () => {
      // `predicate` is a synthetic key, so drawn-differs-from-written is trivially
      // true of it and would print "written as collapsed:urn:…", which says nothing.
      expect(edgePanelSummary(collapsed())).toMatchObject({
        drawn: 'HTTP request',
        collapsed: true,
        flipped: false,
        derived: true,
        invertible: false,
        payloadLabel: 'HTTP request',
      });
    });

    it('has no definition to show, since no predicate was written', () => {
      expect(edgePanelSummary(collapsed()).definition).toBe(null);
    });

    it('lists both written triples, each carrying its own predicate', () => {
      // The whole reason for standsFor: foldedFrom/foldedTo are two endpoint sets
      // read against one predicate, and these two legs have two different ones.
      expect(edgePanelSummary(collapsed()).standsFor).toEqual([
        { source: 'client', predicate: 'd3f:produces', target: 'request' },
        { source: 'api', predicate: 'd3f:executes', target: 'request' },
      ]);
    });

    it('keeps the ×N count off the payload name when several paths merged', () => {
      const merged = edgePanelSummary(collapsed({ label: 'HTTP request ×2', foldedCount: 2 }));
      expect(merged.drawn).toBe('HTTP request');
      expect(merged.foldedCount).toBe(2);
    });
  });

  it('survives an edge with nothing on it, since the panel must still open', () => {
    expect(edgePanelSummary()).toMatchObject({
      drawn: '',
      written: '',
      flipped: false,
      kind: 'other',
      invertible: false,
      definition: null,
      derived: false,
      standsFor: [],
      alternatives: [],
    });
  });

  describe('alternative predicates', () => {
    const candidate = (over = {}) => ({
      direction: 'out',
      tier: 'exact',
      predicate: 'd3f:instructs',
      via: 'Software',
      filler: 'Process',
      inverse: null,
      ...over,
    });

    it('is empty when the shell hands it nothing, not undefined', () => {
      // The panel opens on an edge whose ends carry no d3f: class at all, and a
      // missing list must render as "none licensed" rather than throw.
      expect(edgePanelSummary(edge()).alternatives).toEqual([]);
    });

    it('marks the candidate that is the predicate already drawn', () => {
      const summary = edgePanelSummary(edge({ predicate: 'd3f:instructs' }), {
        alternatives: [candidate(), candidate({ predicate: 'd3f:contains', filler: 'ExecutableFile' })],
      });
      expect(summary.alternatives.map((row) => [row.predicate, row.current])).toEqual([
        ['d3f:instructs', true],
        ['d3f:contains', false],
      ]);
    });

    it('marks against the written predicate, not the drawn one', () => {
      // A flipped edge draws its inverse name, which is not what the ontology
      // states and not what a candidate row can equal.
      const summary = edgePanelSummary(edge({ predicate: 'd3f:instructs', label: 'd3f:instructed-by' }), {
        alternatives: [candidate()],
      });
      expect(summary.flipped).toBe(true);
      expect(summary.alternatives[0].current).toBe(true);
    });

    it('keeps the rest of the row untouched, so the panel can print it', () => {
      const summary = edgePanelSummary(edge(), {
        alternatives: [candidate({ direction: 'in', tier: 'narrower', inverse: 'd3f:instructed-by' })],
      });
      expect(summary.alternatives[0]).toMatchObject({
        direction: 'in',
        tier: 'narrower',
        via: 'Software',
        filler: 'Process',
        inverse: 'd3f:instructed-by',
      });
    });

    describe('badges', () => {
      it('says which way round the axiom is written, since the arrow does not', () => {
        // The row's two chips are the axiom's own ends, so the arrow between them
        // always points along it. An `in` candidate is the same relation stated
        // from the other end, and this is what says so.
        expect(alternativeBadges(candidate({ direction: 'in', inverse: 'd3f:instructs' }))).toEqual([
          'written the other way',
        ]);
        expect(alternativeBadges(candidate({ inverse: 'd3f:instructed-by' }))).toEqual([]);
      });

      it('marks the predicate already drawn', () => {
        expect(alternativeBadges(candidate({ current: true, inverse: 'd3f:x' }))).toEqual(['as drawn']);
      });

      it('says a filler below the drawn class is narrower', () => {
        expect(alternativeBadges(candidate({ tier: 'narrower', inverse: 'd3f:x' }))).toEqual(['narrower']);
      });

      it('says when nothing could swap the link, which is most predicates', () => {
        expect(alternativeBadges(candidate())).toEqual(['no inverse']);
      });

      it('stacks them in one order, and survives an empty row', () => {
        expect(
          alternativeBadges(candidate({ current: true, direction: 'in', tier: 'narrower' })),
        ).toEqual(['as drawn', 'written the other way', 'narrower', 'no inverse']);
        expect(alternativeBadges()).toEqual(['no inverse']);
      });
    });
  });
});
