/**
 * A characterisation test of elkjs itself, not of this app's code.
 *
 * The tier feature hands ELK a layer per node. `elk.layered.layering.layerChoiceConstraint`
 * looked like the way to do that and is not: its own doc string in the bundle says it "is
 * only evaluated as part of the InteractiveLayeredGraphVisitor", which `cytoscape-elk`
 * never runs. Layout partitioning is the mechanism that is left, and this file is the gate
 * the plan puts in front of building on it: if case 2 fails, the design falls back to
 * snapping positions after the layout instead.
 *
 * Everything here asserts on `x`, because `elk.direction: RIGHT` makes a layer a column:
 * two nodes in one layer share an `x`.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let ELK;

beforeAll(async () => {
  ({ default: ELK } = await import('elkjs/lib/elk.bundled.js'));
});

/** The options every case shares: a layered left-to-right drawing. */
const BASE = {
  algorithm: 'layered',
  'elk.direction': 'RIGHT',
};

/** One fixed-size node, so a column is decided by the layout rather than by label text. */
function node(id, options) {
  return { id, width: 80, height: 40, ...(options ? { layoutOptions: options } : {}) };
}

function edge(source, target) {
  return { id: `${source}->${target}`, sources: [source], targets: [target] };
}

/** `id -> x`, flattened across the hierarchy so a child is comparable with a root node. */
function positions(graph, offset = 0, into = new Map()) {
  for (const child of graph.children ?? []) {
    into.set(child.id, offset + child.x);
    positions(child, offset + child.x, into);
  }
  return into;
}

const layout = async (graph) => positions(await new ELK().layout(graph));

describe('what ELK does with a standby replica', () => {
  // user -> fe -> be -> db, plus the one link that is not a flow: db -> db-standby.
  const chain = [edge('user', 'fe'), edge('fe', 'be'), edge('be', 'db')];

  it('pushes it past its tier when the non-flow edge is laid out', async () => {
    const x = await layout({
      id: 'root',
      layoutOptions: BASE,
      children: ['user', 'fe', 'be', 'db', 'standby'].map((id) => node(id)),
      edges: [...chain, edge('db', 'standby')],
    });
    // The bug, stated as a test: an edge forces layer(target) > layer(source), so the
    // standby lands in a column of its own beyond the database it copies.
    expect(x.get('standby')).toBeGreaterThan(x.get('db'));
  });

  it('keeps it in its tier when partitions are given and the non-flow edge is not', async () => {
    const tiers = { user: 0, fe: 1, be: 2, db: 3, standby: 3 };
    const x = await layout({
      id: 'root',
      layoutOptions: {
        ...BASE,
        'elk.partitioning.activate': true,
        // Mandatory rather than a preference: dropping the non-flow edge leaves `standby`
        // in a component of its own, and `layered` separates components before the
        // partition preprocessor runs — so the two would be laid out side by side, each
        // with its own column 0.
        'elk.separateConnectedComponents': false,
      },
      children: Object.entries(tiers).map(([id, partition]) =>
        node(id, { 'elk.partitioning.partition': partition }),
      ),
      edges: chain,
    });

    // The go/no-go: the standby shares the database's column, with the chain still ordered.
    expect(x.get('standby')).toBe(x.get('db'));
    expect(x.get('user')).toBeLessThan(x.get('fe'));
    expect(x.get('fe')).toBeLessThan(x.get('be'));
    expect(x.get('be')).toBeLessThan(x.get('db'));
  });
});

describe('partitions and containers', () => {
  // fe and be inside one container, which is what a subgraph in the mermaid source draws.
  const childrenOf = (parentOptions) => [
    node('user', { 'elk.partitioning.partition': 0 }),
    {
      id: 'box',
      layoutOptions: parentOptions,
      children: [
        node('fe', { 'elk.partitioning.partition': 1 }),
        node('be', { 'elk.partitioning.partition': 2 }),
      ],
      edges: [],
    },
    node('db', { 'elk.partitioning.partition': 3 }),
    node('standby', { 'elk.partitioning.partition': 3 }),
  ];

  const options = {
    ...BASE,
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.partitioning.activate': true,
    'elk.separateConnectedComponents': false,
  };

  const chain = [edge('user', 'fe'), edge('fe', 'be'), edge('be', 'db')];

  it('holds every tier when the container carries a partition of its own', async () => {
    const x = await layout({
      id: 'root',
      layoutOptions: options,
      children: childrenOf({ 'elk.partitioning.partition': 1 }),
      edges: chain,
    });
    expect(x.get('user')).toBeLessThan(x.get('fe'));
    expect(x.get('fe')).toBeLessThan(x.get('be'));
    expect(x.get('be')).toBeLessThan(x.get('db'));
    expect(x.get('standby')).toBe(x.get('db'));
  });

  it('loses them when it carries none, so a parent must be given one too', async () => {
    // The answer to the plan's open question. A partitioned graph holding one unpartitioned
    // node is not partly partitioned: ELK puts the container where the edges take it, and
    // the nodes outside it move to suit — `db` slides past the tier `standby` was pinned
    // to, and the two no longer share a column. So layouts.js emits a partition for every
    // node it draws, parents included, rather than only for leaves.
    const x = await layout({
      id: 'root',
      layoutOptions: options,
      children: childrenOf(undefined),
      edges: chain,
    });
    expect(x.get('standby')).not.toBe(x.get('db'));
  });
});

describe('a layer constraint alongside a partition', () => {
  it('still puts the first node first', async () => {
    // `layerConstraint: FIRST` is what the flow root sets today. Tier 0 says the same
    // thing, so the question is only whether holding both throws or contradicts.
    const x = await layout({
      id: 'root',
      layoutOptions: {
        ...BASE,
        'elk.partitioning.activate': true,
        'elk.separateConnectedComponents': false,
      },
      children: [
        node('user', {
          'elk.partitioning.partition': 0,
          'elk.layered.layering.layerConstraint': 'FIRST',
        }),
        node('fe', { 'elk.partitioning.partition': 1 }),
        node('db', { 'elk.partitioning.partition': 2 }),
      ],
      edges: [edge('user', 'fe'), edge('fe', 'db')],
    });
    expect(x.get('user')).toBeLessThan(x.get('fe'));
    expect(x.get('fe')).toBeLessThan(x.get('db'));
  });
});
