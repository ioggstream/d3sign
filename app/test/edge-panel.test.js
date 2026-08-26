import { describe, it, expect } from 'vitest';
import { edgePanelSummary } from '../src/viz/edgePanel.js';

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
    });
  });
});
