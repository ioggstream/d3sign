import { describe, it, expect } from 'vitest';

import { tierLayers, layoutRoots, TIER_FLOW_KINDS } from '../src/viz/tierLayers.js';

/** The records the pane extracts from cytoscape; only `id` is ever required. */
const node = (id, extra = {}) => ({ id, isParent: false, parentId: null, ...extra });

const link = (source, target, kind = 'data-flow', extra = {}) => ({
  id: `${source}->${target}:${kind}`,
  source,
  target,
  kind,
  bidirectional: false,
  ...extra,
});

/** The multi-tier platform: a user, a frontend, a backend, a database, a standby replica. */
function platform() {
  const nodes = ['user', 'fe', 'be', 'db', 'standby'].map((id) => node(id));
  const edges = [
    link('user', 'fe'),
    link('fe', 'be'),
    link('be', 'db'),
    // The standby's only links, and not one of them is a flow.
    link('standby', 'db', 'other'),
    link('standby', 'db', 'tactical-verb'),
  ];
  return { nodes, edges };
}

describe('tierLayers', () => {
  it('reads a chain as one tier per hop', () => {
    const { nodes, edges } = platform();
    const tiers = tierLayers(nodes, edges);
    expect(tiers.get('user')).toBe(0);
    expect(tiers.get('fe')).toBe(1);
    expect(tiers.get('be')).toBe(2);
    expect(tiers.get('db')).toBe(3);
  });

  it('puts a standby replica in its database’s tier, not in the first one', () => {
    // The bug this module exists for: `d3f:copy-of` and `d3f:monitors` say the standby is
    // the same thing as the database, not that it comes before it.
    const { nodes, edges } = platform();
    expect(tierLayers(nodes, edges).get('standby')).toBe(3);
  });

  it('leaves the tiers alone when a non-flow link is added or removed', () => {
    const { nodes, edges } = platform();
    const before = tierLayers(nodes, edges);
    const after = tierLayers(nodes, [...edges, link('fe', 'db', 'connectivity')]);
    expect([...after]).toEqual([...before]);
  });

  it('takes the longest path, so a shortcut cannot pull a tier forward', () => {
    const { nodes, edges } = platform();
    const tiers = tierLayers(nodes, [...edges, link('user', 'db')]);
    expect(tiers.get('db')).toBe(3);
  });

  it('gives a cycle one tier rather than picking an order inside it', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => node(id));
    const tiers = tierLayers(nodes, [
      link('a', 'b'),
      // b and c call each other: nothing says which is first.
      link('b', 'c'),
      link('c', 'b'),
      link('c', 'd'),
    ]);
    expect(tiers.get('b')).toBe(tiers.get('c'));
    expect(tiers.get('a')).toBeLessThan(tiers.get('b'));
    expect(tiers.get('d')).toBeGreaterThan(tiers.get('c'));
  });

  it('steps across a two-way link in the direction it is drawn', () => {
    // One element standing for the relation asserted both ways (viz/toCytoscape.js).
    // Walking it both ways here would make every such pair a cycle and flatten the tiers.
    const nodes = ['a', 'b'].map((id) => node(id));
    const tiers = tierLayers(nodes, [link('a', 'b', 'data-flow', { bidirectional: true })]);
    expect(tiers.get('a')).toBe(0);
    expect(tiers.get('b')).toBe(1);
  });

  it('draws nothing before the node the reading starts from', () => {
    const { nodes, edges } = platform();
    const tiers = tierLayers(nodes, edges, { rootId: 'be' });
    expect(tiers.get('be')).toBe(0);
    expect(tiers.get('db')).toBe(1);
    // Clamped rather than negative: upstream of the root is not drawn ahead of it.
    expect(tiers.get('user')).toBe(0);
    expect(tiers.get('fe')).toBe(0);
  });

  it('ignores a root that is not drawn', () => {
    const { nodes, edges } = platform();
    expect([...tierLayers(nodes, edges, { rootId: 'gone' })]).toEqual([...tierLayers(nodes, edges)]);
  });

  it('puts an isolated node and a self-loop at the front', () => {
    const nodes = ['lonely', 'looping'].map((id) => node(id));
    const tiers = tierLayers(nodes, [link('looping', 'looping')]);
    expect(tiers.get('lonely')).toBe(0);
    expect(tiers.get('looping')).toBe(0);
  });

  it('gives a container the first tier of what it holds', () => {
    // ELK moves an unpartitioned node wherever its edges lead, taking its neighbours out
    // of their tiers with it (app/test/elk-partitioning.test.js), so a parent needs one.
    const nodes = [
      node('user'),
      node('box', { isParent: true }),
      node('fe', { parentId: 'box' }),
      node('be', { parentId: 'box' }),
      node('db'),
    ];
    const tiers = tierLayers(nodes, [link('user', 'fe'), link('fe', 'be'), link('be', 'db')]);
    expect(tiers.get('box')).toBe(tiers.get('fe'));
    expect(tiers.get('be')).toBeGreaterThan(tiers.get('box'));
  });

  it('covers every node given, whatever it is joined by', () => {
    const { nodes, edges } = platform();
    const tiers = tierLayers([...nodes, node('stray')], edges);
    expect([...tiers.keys()].sort()).toEqual(['be', 'db', 'fe', 'standby', 'stray', 'user']);
    expect([...tiers.values()].every((tier) => Number.isInteger(tier) && tier >= 0)).toBe(true);
  });

  it('does not depend on the order the elements arrive in', () => {
    const { nodes, edges } = platform();
    const forward = tierLayers(nodes, edges);
    const backward = tierLayers([...nodes].reverse(), [...edges].reverse());
    expect([...backward].sort()).toEqual([...forward].sort());
  });

  it('layers on flows and control alone', () => {
    expect(TIER_FLOW_KINDS).toEqual(['data-flow', 'control-flow']);
    const nodes = ['a', 'b'].map((id) => node(id));
    expect(tierLayers(nodes, [link('a', 'b', 'control-flow')]).get('b')).toBe(1);
    expect(tierLayers(nodes, [link('a', 'b', 'location')]).get('b')).toBe(0);
  });
});

describe('layoutRoots', () => {
  it('starts at the chosen node and still reaches everything', () => {
    const { nodes, edges } = platform();
    const roots = layoutRoots(nodes, edges, 'user');
    // The chosen root first, so breadth-first draws it in the first row rather than
    // putting the nodes it cannot reach in a row above it.
    expect(roots[0]).toBe('user');
    expect(roots).toContain('standby');
  });

  it('falls back to the nodes cytoscape would have chosen', () => {
    const { nodes, edges } = platform();
    expect(layoutRoots(nodes, edges)).toEqual(['standby', 'user']);
  });

  it('names a root for a graph that is nothing but a cycle', () => {
    const nodes = ['a', 'b'].map((id) => node(id));
    expect(layoutRoots(nodes, [link('a', 'b'), link('b', 'a')])).toEqual(['a']);
  });

  it('says nothing about an empty graph', () => {
    expect(layoutRoots([], [])).toBe(null);
  });
});
