import { describe, it, expect, vi } from 'vitest';
import { edgeMenuItems, nodeMenuItems } from '../src/viz/nodeMenu.js';
import { mermaidIdOf, writtenTriplesOf } from '../src/goToSource.js';
import { edgeKey } from '../src/editor/sourceLocations.js';

const G = 'urn:d3fend-graph:';
const handlers = (over = {}) => ({
  onFoldToggle: vi.fn(),
  onGoToSource: vi.fn(),
  onShowOutgoingFlow: vi.fn(),
  onShowIncomingFlow: vi.fn(),
  canGoToSource: () => true,
  ...over,
});

describe('nodeMenuItems', () => {
  it('offers jump and directional flow actions for a leaf with source', () => {
    const items = nodeMenuItems({ id: `${G}a` }, handlers());
    expect(items.map((i) => i.label)).toEqual([
      'Go to mermaid source',
      'Show outgoing flow',
      'Show incoming flow',
    ]);
  });

  it('keeps fold first on a container', () => {
    const items = nodeMenuItems({ id: `${G}n1`, foldable: true }, handlers());
    expect(items.map((i) => i.label)).toEqual([
      'Fold',
      'Go to mermaid source',
      'Show outgoing flow',
      'Show incoming flow',
    ]);
  });

  it('says Unfold once folded', () => {
    const items = nodeMenuItems({ id: `${G}n1`, foldable: true, folded: true }, handlers());
    expect(items[0].label).toBe('Unfold');
  });

  it('omits the jump for a node with no mermaid source, keeping the rest', () => {
    // The flow actions read the drawing, not the editor, so they stand on their own.
    const items = nodeMenuItems({ id: `${G}a` }, handlers({ canGoToSource: () => false }));
    expect(items.map((i) => i.label)).toEqual(['Show outgoing flow', 'Show incoming flow']);
  });

  it('keeps the menu shut when nothing is on offer', () => {
    expect(nodeMenuItems({ id: `${G}a` }, {})).toEqual([]);
  });

  it('offers info on every node, since a left click no longer opens it', () => {
    const onShowInfo = vi.fn();
    const leaf = nodeMenuItems({ id: `${G}a` }, { onShowInfo });
    expect(leaf.map((i) => i.label)).toEqual(['Show info']);
    // Last, behind the actions that change what is on screen.
    const container = nodeMenuItems({ id: `${G}n1`, foldable: true }, handlers({ onShowInfo }));
    expect(container.map((i) => i.label)).toEqual([
      'Fold',
      'Go to mermaid source',
      'Show outgoing flow',
      'Show incoming flow',
      'Show info',
    ]);
  });

  it('teaches the gesture that reaches each action without the menu', () => {
    // The menu is the only place these are written down, so every item that has
    // another way in has to name it.
    const items = nodeMenuItems({ id: `${G}n1`, foldable: true }, handlers({ onShowInfo: vi.fn() }));
    expect(items.map((i) => [i.label, i.hint])).toEqual([
      ['Fold', 'f'],
      ['Go to mermaid source', 'g'],
      ['Show outgoing flow', '>'],
      ['Show incoming flow', '<'],
      ['Show info', 'double-click'],
    ]);
  });

  it('offers the query, ahead of info, and teaches its key', () => {
    const onQuery = vi.fn();
    const items = nodeMenuItems({ id: `${G}n1`, foldable: true }, handlers({ onQuery, onShowInfo: vi.fn() }));
    expect(items.map((i) => [i.label, i.hint])).toEqual([
      ['Fold', 'f'],
      ['Go to mermaid source', 'g'],
      ['Show outgoing flow', '>'],
      ['Show incoming flow', '<'],
      ['Query this node', 'q'],
      ['Show info', 'double-click'],
    ]);
    items.find((i) => i.label === 'Query this node').onSelect();
    expect(onQuery).toHaveBeenCalledWith(`${G}n1`);
  });

  it('leaves the query out when the shell offers none', () => {
    const items = nodeMenuItems({ id: `${G}a` }, handlers());
    expect(items.map((i) => i.label)).not.toContain('Query this node');
  });

  it('keeps the hint on Unfold, which is the same key back again', () => {
    const items = nodeMenuItems({ id: `${G}n1`, foldable: true, folded: true }, handlers());
    expect(items[0]).toMatchObject({ label: 'Unfold', hint: 'f' });
  });

  it('hands the whole data to the info panel, which reads more than the id', () => {
    const onShowInfo = vi.fn();
    const data = { id: `${G}a`, label: 'a\nAlpha' };
    nodeMenuItems(data, { onShowInfo })[0].onSelect();
    expect(onShowInfo).toHaveBeenCalledWith(data);
  });

  it('describes every action, since the label only has room for what to press', () => {
    // The description is the menu item's tooltip (viz/graphPane.js). Asserted over
    // both menus with every handler wired, so a new item cannot ship without one.
    const nodeItems = nodeMenuItems({ id: `${G}n1`, foldable: true }, { ...handlers(), onQuery: vi.fn(), onShowInfo: vi.fn() });
    const edgeItems = edgeMenuItems(
      { predicate: 'd3f:reads', invertible: true },
      { onSwapDirection: vi.fn(), onGoToEdgeSource: vi.fn(), canGoToEdgeSource: () => true, onShowEdgeInfo: vi.fn() },
    );
    expect(nodeItems.length).toBeGreaterThan(0);
    expect(edgeItems.length).toBeGreaterThan(0);
    for (const item of [...nodeItems, ...edgeItems]) {
      expect(item.description, item.label).toBeTruthy();
      expect(item.description).not.toBe(item.label);
    }
  });

  it('forwards the node id', () => {
    const h = handlers();
    nodeMenuItems({ id: `${G}a`, foldable: true }, h).forEach((i) => i.onSelect());
    expect(h.onFoldToggle).toHaveBeenCalledWith(`${G}a`);
    expect(h.onGoToSource).toHaveBeenCalledWith(`${G}a`);
    expect(h.onShowOutgoingFlow).toHaveBeenCalledWith(`${G}a`);
    expect(h.onShowIncomingFlow).toHaveBeenCalledWith(`${G}a`);
  });
});

describe('edgeMenuItems', () => {
  const data = { predicate: 'd3f:reads', source: `${G}a`, target: `${G}b`, invertible: true };
  const edgeHandlers = (over = {}) => ({
    onSwapDirection: vi.fn(),
    onGoToEdgeSource: vi.fn(),
    canGoToEdgeSource: () => true,
    onShowEdgeInfo: vi.fn(),
    ...over,
  });

  it('offers the jump when the edge is written somewhere', () => {
    const items = edgeMenuItems(data, {
      onGoToEdgeSource: vi.fn(),
      canGoToEdgeSource: () => true,
    });
    expect(items.map((i) => i.label)).toEqual(['Go to mermaid source']);
  });

  it('puts the swap first, where the left click used to be', () => {
    const items = edgeMenuItems(data, edgeHandlers());
    expect(items.map((i) => i.label)).toEqual(['Swap direction', 'Go to mermaid source', 'Show info']);
  });

  it('teaches the gesture that reaches each action without the menu', () => {
    // An edge can be selected now, so every one of these has a key and the menu
    // has to name it — this is the only place a user finds out.
    const items = edgeMenuItems(data, edgeHandlers());
    expect(items.map((i) => [i.label, i.hint])).toEqual([
      ['Swap direction', 's'],
      ['Go to mermaid source', 'g'],
      ['Show info', 'double-click'],
    ]);
  });

  it('omits the swap when the predicate has no inverse to swap to', () => {
    const items = edgeMenuItems({ ...data, invertible: false }, edgeHandlers());
    expect(items.map((i) => i.label)).toEqual(['Go to mermaid source', 'Show info']);
  });

  it('offers info even for an edge with no mermaid source', () => {
    const items = edgeMenuItems(data, edgeHandlers({ canGoToEdgeSource: () => false }));
    expect(items.map((i) => i.label)).toEqual(['Swap direction', 'Show info']);
  });

  it('keeps the menu shut when nothing is on offer', () => {
    expect(edgeMenuItems(data, {})).toEqual([]);
  });

  it('forwards the whole data — the shell needs more than an id', () => {
    const h = edgeHandlers();
    const items = edgeMenuItems(data, h);
    items.find((i) => i.label === 'Go to mermaid source').onSelect();
    items.find((i) => i.label === 'Show info').onSelect();
    expect(h.onGoToEdgeSource).toHaveBeenCalledWith(data);
    expect(h.onShowEdgeInfo).toHaveBeenCalledWith(data);
  });

  it('swaps by the written predicate, never by the drawn label', () => {
    // The swap is per-predicate and global, and `predicate` is the CURIE as
    // written — handing over the inverse label would flip nothing.
    const h = edgeHandlers();
    edgeMenuItems({ ...data, label: 'd3f:read-by' }, h)[0].onSelect();
    expect(h.onSwapDirection).toHaveBeenCalledWith('d3f:reads');
  });
});

describe('mermaidIdOf', () => {
  it('recovers the id the diagram used', () => {
    expect(mermaidIdOf(`${G}dev-pk`)).toBe('dev-pk');
  });

  it('rejects enrichment nodes, whose prefix extends the graph one', () => {
    expect(mermaidIdOf(`${G}enrichment:dev-pk`)).toBe(null);
  });

  it('rejects IRIs from outside the diagram', () => {
    expect(mermaidIdOf('http://d3fend.mitre.org/ontologies/d3fend.owl#Host')).toBe(null);
    expect(mermaidIdOf(undefined)).toBe(null);
  });
});

describe('writtenTriplesOf', () => {
  const forward = { direction: new Map() };
  const inverse = { direction: new Map([['d3f:reads', 'inverse']]) };

  it('reads a plain edge straight off', () => {
    const data = { predicate: 'd3f:reads', source: `${G}a`, target: `${G}b` };
    expect(writtenTriplesOf(data, forward)).toEqual([edgeKey('a', 'd3f:reads', 'b')]);
  });

  it('un-swaps an edge the Links filter is drawing backwards', () => {
    const data = {
      predicate: 'd3f:reads',
      source: `${G}b`,
      target: `${G}a`,
      invertible: true,
    };
    expect(writtenTriplesOf(data, inverse)).toEqual([edgeKey('a', 'd3f:reads', 'b')]);
  });

  it('leaves a non-invertible edge alone even when the predicate is flipped', () => {
    const data = { predicate: 'd3f:reads', source: `${G}a`, target: `${G}b` };
    expect(writtenTriplesOf(data, inverse)).toEqual([edgeKey('a', 'd3f:reads', 'b')]);
  });

  it('expands a folded edge back to the links it collapsed', () => {
    const data = {
      predicate: 'd3f:reads',
      source: `${G}box`,
      target: `${G}b`,
      derived: true,
      foldedFrom: [`${G}a1`, `${G}a2`],
      foldedTo: [`${G}b`],
    };
    expect(writtenTriplesOf(data, forward)).toEqual([
      edgeKey('a1', 'd3f:reads', 'b'),
      edgeKey('a2', 'd3f:reads', 'b'),
    ]);
  });

  it('drops endpoints with no mermaid origin', () => {
    const data = {
      predicate: 'd3f:reads',
      source: `${G}enrichment:a`,
      target: `${G}b`,
    };
    expect(writtenTriplesOf(data, forward)).toEqual([]);
  });

  it('reads both legs of a collapsed artifact path off standsFor', () => {
    // Its predicate is synthetic, so the usual key would match nothing; and both
    // legs are real mermaid arrows, so repeated `g` walks between them.
    const data = {
      predicate: `collapsed:${G}request`,
      source: `${G}client`,
      target: `${G}api`,
      derived: true,
      collapsed: true,
      standsFor: [
        { from: `${G}client`, predicate: 'd3f:produces', to: `${G}request` },
        { from: `${G}api`, predicate: 'd3f:executes', to: `${G}request` },
      ],
    };
    const expected = [
      edgeKey('client', 'd3f:produces', 'request'),
      edgeKey('api', 'd3f:executes', 'request'),
    ];
    expect(writtenTriplesOf(data, forward)).toEqual(expected);
    // Nothing to un-swap: `direction` never applied to a predicate nobody wrote.
    expect(writtenTriplesOf(data, inverse)).toEqual(expected);
  });
});
