import { describe, it, expect } from 'vitest';
import { selectionLabel } from '../src/viz/selectionBox.js';

const G = 'urn:d3fend-graph:';

describe('selectionLabel', () => {
  it('says so when nothing is selected', () => {
    expect(selectionLabel(null)).toBe('no selection');
  });

  it('names a leaf by the id the diagram used, and advertises flow shortcuts', () => {
    expect(selectionLabel({ id: `${G}db-1`, foldable: false, folded: false })).toBe('db-1 · >/<: flow');
  });

  it('advertises the shortcut on a container, which is the only place it is written down', () => {
    expect(selectionLabel({ id: `${G}svc`, foldable: true, folded: false })).toBe('svc · f: fold · >/<: flow');
  });

  it('offers the way back once folded', () => {
    expect(selectionLabel({ id: `${G}svc`, foldable: true, folded: true })).toBe('svc · f: unfold · >/<: flow');
  });

  it('shortens an IRI from outside the diagram the way the node label does', () => {
    const iri = 'http://d3fend.mitre.org/ontologies/d3fend.owl#PublicKey';
    expect(selectionLabel({ id: iri, foldable: false })).toBe('d3f:PublicKey · >/<: flow');
  });
});

describe('selectionLabel on an edge', () => {
  const edge = (over = {}) => ({
    kind: 'edge',
    id: `${G}a->${G}b:d3f:reads`,
    predicate: 'd3f:reads',
    label: 'd3f:reads',
    source: `${G}a`,
    target: `${G}b`,
    invertible: true,
    ...over,
  });

  it('names the relation and both ends, shortened like the nodes are', () => {
    expect(selectionLabel(edge())).toBe('d3f:reads: a → b · s: swap all d3f:reads');
  });

  it('says the swap is per predicate, which is the blast radius of the key', () => {
    // Pressing `s` flips every edge sharing the predicate, not the one arrow that
    // was clicked, so the box has to name the predicate and not the edge.
    expect(selectionLabel(edge())).toContain('swap all d3f:reads');
  });

  it('reads the arrow as drawn while naming the predicate as written', () => {
    const flipped = edge({ label: 'd3f:read-by', source: `${G}b`, target: `${G}a` });
    expect(selectionLabel(flipped)).toBe('d3f:read-by: b → a · s: swap all d3f:reads');
  });

  it('offers no shortcut when the predicate has no inverse', () => {
    expect(selectionLabel(edge({ invertible: false }))).toBe('d3f:reads: a → b');
  });

  it('keeps a folded edge’s count, which says the arrow is more than one link', () => {
    const folded = edge({ label: 'd3f:reads ×3', source: `${G}box` });
    expect(selectionLabel(folded)).toBe('d3f:reads ×3: box → b · s: swap all d3f:reads');
  });
});
