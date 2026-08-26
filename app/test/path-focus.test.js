import { describe, it, expect } from 'vitest';
import { directionalFlow } from '../src/viz/pathFocus.js';

describe('directionalFlow', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'];
  const edges = [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
    { id: 'bd', source: 'b', target: 'd' },
    { id: 'db', source: 'd', target: 'b' },
    { id: 'de', source: 'd', target: 'e' },
  ];

  it('walks all reachable outgoing flow', () => {
    const flow = directionalFlow(nodes, edges, 'a', 'outgoing');
    expect([...flow.nodeIds].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...flow.edgeIds].sort()).toEqual(['ab', 'bc', 'bd', 'db', 'de']);
  });

  it('walks all reachable incoming flow', () => {
    const flow = directionalFlow(nodes, edges, 'e', 'incoming');
    expect([...flow.nodeIds].sort()).toEqual(['a', 'b', 'd', 'e']);
    expect([...flow.edgeIds].sort()).toEqual(['ab', 'bd', 'db', 'de']);
  });

  it('is cycle-safe', () => {
    const flow = directionalFlow(nodes, edges, 'b', 'outgoing');
    expect(flow.nodeIds.has('b')).toBe(true);
    expect(flow.edgeIds.has('db')).toBe(true);
  });

  it('walks a collapsed artifact path one way only', () => {
    // A collapsed path is one arrow standing for two links that both run the same
    // way, so it must never carry `bidirectional`: that would claim the consumer
    // feeds the producer. Reachability through it is otherwise exactly what the
    // two-hop path gave, minus the payload node.
    const collapsed = [
      { id: 'client->api', source: 'client', target: 'api', collapsed: true, derived: true },
    ];
    const outgoing = directionalFlow(['client', 'api'], collapsed, 'client', 'outgoing');
    expect([...outgoing.nodeIds].sort()).toEqual(['api', 'client']);
    expect(directionalFlow(['client', 'api'], collapsed, 'api', 'outgoing').nodeIds.has('client')).toBe(
      false,
    );
  });

  it('walks a two-way link from either end', () => {
    // One element standing for the relation asserted each way, so the flow must
    // not depend on which of the two triples ended up as its source.
    const both = [{ id: 'xy', source: 'x', target: 'y', bidirectional: true }];
    const outgoing = directionalFlow(['x', 'y'], both, 'y', 'outgoing');
    expect([...outgoing.nodeIds].sort()).toEqual(['x', 'y']);
    expect([...outgoing.edgeIds]).toEqual(['xy']);

    const incoming = directionalFlow(['x', 'y'], both, 'x', 'incoming');
    expect([...incoming.nodeIds].sort()).toEqual(['x', 'y']);
  });

  it('returns empty sets when start node is not present', () => {
    const flow = directionalFlow(nodes, edges, 'missing', 'outgoing');
    expect(flow.nodeIds.size).toBe(0);
    expect(flow.edgeIds.size).toBe(0);
  });
});
