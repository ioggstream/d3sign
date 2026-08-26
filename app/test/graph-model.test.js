import { describe, it, expect } from 'vitest';
import { Parser, DataFactory } from 'n3';
import { GraphStore } from '../src/rdf/store.js';
import { buildGraphModel, modelPredicates, displayIdOf } from '../src/rdf/graphModel.js';
import { toCytoscapeElements } from '../src/viz/toCytoscape.js';
import { LINK_KINDS } from '../src/rdf/linkKind.js';
import { NODE_KINDS } from '../src/rdf/nodeKind.js';

const { namedNode, quad } = DataFactory;

const PREAMBLE = `
@prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix G: <urn:d3fend-graph:> .
`;

/** A store built from turtle alone — no mermaid anywhere in this file. */
function storeFromTurtle(turtle) {
  const store = new GraphStore();
  store.addQuads(new Parser().parse(PREAMBLE + turtle));
  return store;
}

function filterState({
  predicates = [],
  direction = new Map(),
  nodeKinds = NODE_KINDS,
  kinds = LINK_KINDS,
  folded = [],
} = {}) {
  return {
    visiblePredicates: new Set(predicates),
    direction,
    visibleKinds: new Set(kinds),
    visibleNodeKinds: new Set(nodeKinds),
    foldedNodes: new Set(folded.map((id) => `urn:d3fend-graph:${id}`)),
  };
}

describe('displayIdOf', () => {
  it('strips the graph-local prefixes and CURIEs everything else', () => {
    expect(displayIdOf('urn:d3fend-graph:dev-pk')).toBe('dev-pk');
    expect(displayIdOf('urn:d3fend-graph:enrichment:ssh-flow')).toBe('ssh-flow');
    expect(displayIdOf('http://d3fend.mitre.org/ontologies/d3fend.owl#PublicKey')).toBe('d3f:PublicKey');
    expect(displayIdOf('http://example.org/thing')).toBe('http://example.org/thing');
  });
});

describe('buildGraphModel — from turtle only', () => {
  const store = storeFromTurtle(`
    G:net a d3f:Network ; rdfs:label "LAN" ; d3f:contains G:client, G:server .
    G:client a d3f:Browser ; rdfs:label "Browser" ; d3f:reads G:server .
    G:server a d3f:WebServer .
    G:alice a d3f:User ; d3f:authenticates G:server .
  `);
  const model = buildGraphModel(store);

  it('makes a node of every resource, and none of the literals or classes', () => {
    expect([...model.nodes.keys()].map(displayIdOf).sort()).toEqual(['alice', 'client', 'net', 'server']);
  });

  it('reads labels and the rdf:type from the quads', () => {
    const client = model.nodes.get('urn:d3fend-graph:client');
    expect(client.label).toBe('Browser');
    expect(client.rdfType).toBe('d3f:Browser');
  });

  it('falls back to the local name when a node has no rdfs:label', () => {
    const server = model.nodes.get('urn:d3fend-graph:server');
    expect(server.id).toBe('server');
    expect(server.label).toBe('');
  });

  it('classifies node kinds from the D3FENDCore branch of the classes', () => {
    expect(model.nodes.get('urn:d3fend-graph:alice').nodeKind).toBe('actors');
    expect(model.nodes.get('urn:d3fend-graph:client').nodeKind).toBe('artifacts');
  });

  it('marks a node typed with an offensive technique, and only that node', () => {
    // The flag rides beside the branch rather than replacing it: an ATT&CK
    // technique's branch is Plan, the same as a countermeasure's, so the Nodes
    // filter still buckets it as Tactical while the drawing colours it apart.
    // The class IRI in full: a dotted local name is legal turtle but reads as a
    // trap, and the point here is the flag, not the parser.
    const attackStore = storeFromTurtle(`
      G:guess a <http://d3fend.mitre.org/ontologies/d3fend.owl#T1110.001> .
      G:decoy a d3f:DecoyPersona .
    `);
    const attacked = buildGraphModel(attackStore);
    const guess = attacked.nodes.get('urn:d3fend-graph:guess');
    expect(guess.offensive).toBe(true);
    expect(guess.coreCategory).toBe('Plan');
    expect(guess.nodeKind).toBe('tactical');

    const decoy = attacked.nodes.get('urn:d3fend-graph:decoy');
    expect(decoy.offensive).toBe(false);
    expect(decoy.coreCategory).toBe('Plan');

    // And it reaches the drawing, where the stylesheet reads `node[offensive]`.
    const { elements } = toCytoscapeElements(attacked, filterState());
    const dataOf = (id) => elements.find((e) => e.data.id === `urn:d3fend-graph:${id}`).data;
    expect(dataOf('guess').offensive).toBe(true);
    expect(dataOf('decoy').offensive).toBeUndefined();
  });

  it('turns d3f:contains into containment, not into an edge', () => {
    expect(model.containment.get('urn:d3fend-graph:net')).toEqual([
      'urn:d3fend-graph:client',
      'urn:d3fend-graph:server',
    ]);
    expect(model.parentOf.get('urn:d3fend-graph:client')).toBe('urn:d3fend-graph:net');
    expect(modelPredicates(model).sort()).toEqual(['d3f:authenticates', 'd3f:reads']);
  });

  it('classifies edges and resolves their inverse predicate', () => {
    const reads = model.edges.find((e) => e.predicate === 'd3f:reads');
    expect(reads).toMatchObject({
      from: 'urn:d3fend-graph:client',
      to: 'urn:d3fend-graph:server',
      kind: 'data-flow',
      inverse: 'd3f:read-by',
    });
    // Which kind each predicate gets is linkKind.js's business, tested there;
    // here it only matters that every edge carries one.
    expect(model.edges.every((e) => LINK_KINDS.includes(e.kind))).toBe(true);
  });

  it('ignores a self-containment instead of making a node its own parent', () => {
    const selfModel = buildGraphModel(storeFromTurtle('G:loop a d3f:Network ; d3f:contains G:loop .'));
    expect(selfModel.parentOf.size).toBe(0);
    expect(selfModel.edges).toEqual([]);
  });
});

describe('toCytoscapeElements — from turtle only', () => {
  const store = storeFromTurtle(`
    G:net a d3f:Network ; rdfs:label "LAN" ; d3f:contains G:client, G:server .
    G:client a d3f:Browser ; d3f:reads G:server .
    G:server a d3f:WebServer .
    G:alice a d3f:User ; d3f:authenticates G:server .
  `);
  const model = buildGraphModel(store);
  const predicates = modelPredicates(model);

  const nodesOf = (elements) => elements.filter((e) => !e.data.source);
  const edgesOf = (elements) => elements.filter((e) => e.data.source);

  it('renders a graph that never came from mermaid', () => {
    const { elements, stats } = toCytoscapeElements(model, filterState({ predicates }));
    expect(stats).toEqual({ nodesShown: 4, nodesTotal: 4, edgesShown: 2, edgesTotal: 2 });
    expect(edgesOf(elements).map((e) => e.data.label).sort()).toEqual([
      'd3f:authenticates',
      'd3f:reads',
    ]);
  });

  it('marks the container and parents its children', () => {
    const { elements } = toCytoscapeElements(model, filterState({ predicates }));
    const byId = new Map(nodesOf(elements).map((e) => [e.data.id, e.data]));
    expect(byId.get('urn:d3fend-graph:net').isContainer).toBe(true);
    expect(byId.get('urn:d3fend-graph:client').parent).toBe('urn:d3fend-graph:net');
    expect(byId.get('urn:d3fend-graph:alice').parent).toBeUndefined();
  });

  it('stacks id, label and type on the node label', () => {
    const { elements } = toCytoscapeElements(model, filterState({ predicates }));
    const net = nodesOf(elements).find((e) => e.data.id === 'urn:d3fend-graph:net');
    expect(net.data.label).toBe('net\nLAN\nd3f:Network');
  });

  it("carries the class's local name, which the icon set is keyed on", () => {
    const { elements } = toCytoscapeElements(model, filterState({ predicates }));
    const byId = new Map(nodesOf(elements).map((e) => [e.data.id, e.data]));
    // The bare local name, not the CURIE the label line shows.
    expect(byId.get('urn:d3fend-graph:client').typeName).toBe('Browser');
    expect(byId.get('urn:d3fend-graph:net').typeName).toBe('Network');
  });

  it('hides an edge whose predicate is filtered out', () => {
    const { stats } = toCytoscapeElements(model, filterState({ predicates: ['d3f:reads'] }));
    expect(stats.edgesShown).toBe(1);
    expect(stats.edgesTotal).toBe(2);
  });

  it('drops edges whose endpoint lost the node-kind filter', () => {
    const { stats } = toCytoscapeElements(
      model,
      filterState({ predicates, nodeKinds: ['artifacts'] }),
    );
    // alice (actors) is gone, and with her the d3f:authenticates edge.
    expect(stats).toMatchObject({ nodesShown: 3, nodesTotal: 4, edgesShown: 1 });
  });

  it('reparents a child onto the nearest visible ancestor when the container is hidden', () => {
    const nested = buildGraphModel(storeFromTurtle(`
      G:outer a d3f:Network ; d3f:contains G:mid .
      G:mid a d3f:User ; d3f:contains G:leaf .
      G:leaf a d3f:Browser .
    `));
    const { elements } = toCytoscapeElements(nested, filterState({ nodeKinds: ['artifacts'] }));
    const leaf = elements.find((e) => e.data.id === 'urn:d3fend-graph:leaf');
    expect(leaf.data.parent).toBe('urn:d3fend-graph:outer');
  });

  it('swaps an edge end-for-end when its predicate is inverted', () => {
    const { elements } = toCytoscapeElements(
      model,
      filterState({ predicates, direction: new Map([['d3f:reads', 'inverse']]) }),
    );
    const reads = edgesOf(elements).find((e) => e.data.predicate === 'd3f:reads');
    expect(reads.data).toMatchObject({
      source: 'urn:d3fend-graph:server',
      target: 'urn:d3fend-graph:client',
      label: 'd3f:read-by',
    });
  });

  it('gives each copy of a relation asserted in two named graphs its own element id', () => {
    const store2 = new GraphStore();
    for (const graphName of ['urn:d3fend-graph:one', 'urn:d3fend-graph:two']) {
      const triple = new Parser().parse(`${PREAMBLE} G:a d3f:reads G:b .`)[0];
      store2.replaceGraph(graphName, [quad(triple.subject, triple.predicate, triple.object, namedNode(graphName))]);
    }
    const duplicated = buildGraphModel(store2);
    expect(duplicated.edges.length).toBe(2);

    const { elements } = toCytoscapeElements(duplicated, filterState({ predicates: ['d3f:reads'] }));
    const ids = elements.filter((e) => e.data.source).map((e) => e.data.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('toCytoscapeElements — relations asserted both ways', () => {
  const G = (id) => `urn:d3fend-graph:${id}`;
  const edgesOf = (elements) => elements.filter((e) => e.data.source);

  it('draws one two-way link for the same predicate in both directions', () => {
    const model = buildGraphModel(storeFromTurtle(`
      G:a a d3f:Switch ; d3f:connected-to G:b .
      G:b a d3f:Switch ; d3f:connected-to G:a .
    `));
    const { elements, stats } = toCytoscapeElements(
      model,
      filterState({ predicates: modelPredicates(model) }),
    );
    const edges = edgesOf(elements);
    expect(edges.length).toBe(1);
    expect(edges[0].data).toMatchObject({
      source: G('a'),
      target: G('b'),
      label: 'd3f:connected-to',
      bidirectional: true,
    });
    // Two triples, one arrow: the total still counts what the store holds.
    expect(stats).toMatchObject({ edgesShown: 1, edgesTotal: 2 });
  });

  it('leaves a one-way relation alone', () => {
    const model = buildGraphModel(storeFromTurtle(`
      G:a a d3f:Switch ; d3f:connected-to G:b .
      G:b a d3f:Switch .
    `));
    const { elements } = toCytoscapeElements(
      model,
      filterState({ predicates: modelPredicates(model) }),
    );
    const [edge] = edgesOf(elements);
    expect(edge.data.bidirectional).toBeUndefined();
  });

  it('does not merge a predicate with its inverse: that is one assertion written twice', () => {
    const model = buildGraphModel(storeFromTurtle(`
      G:a a d3f:Browser ; d3f:reads G:b .
      G:b a d3f:WebServer ; d3f:read-by G:a .
    `));
    const { elements } = toCytoscapeElements(
      model,
      filterState({ predicates: modelPredicates(model) }),
    );
    expect(edgesOf(elements).length).toBe(2);
  });

  it('pairs index-wise, so an odd copy stays a one-way link', () => {
    const model = buildGraphModel(storeFromTurtle(`
      G:a a d3f:Switch ; d3f:connected-to G:b .
      G:b a d3f:Switch .
    `));
    // A second a→b copy, as a relation asserted in two visible named graphs is.
    model.edges.push({ ...model.edges[0] });
    model.edges.push({ ...model.edges[0], from: G('b'), to: G('a') });

    const { elements } = toCytoscapeElements(
      model,
      filterState({ predicates: ['d3f:connected-to'] }),
    );
    const edges = edgesOf(elements);
    expect(edges.length).toBe(2);
    expect(edges.filter((e) => e.data.bidirectional).length).toBe(1);
    expect(new Set(edges.map((e) => e.data.id)).size).toBe(2);
  });

  it('merges the two directions of a link re-anchored by a fold', () => {
    const model = buildGraphModel(storeFromTurtle(`
      G:net a d3f:Network ; d3f:contains G:port .
      G:port a d3f:WiredLink ; d3f:connected-to G:peer .
      G:peer a d3f:Switch ; d3f:connected-to G:port .
    `));
    const { elements } = toCytoscapeElements(
      model,
      filterState({ predicates: modelPredicates(model), folded: ['net'] }),
    );
    const [edge] = edgesOf(elements);
    expect(edge.data).toMatchObject({
      derived: true,
      bidirectional: true,
      foldedCount: 2,
      foldedFrom: [G('port')],
      foldedTo: [G('peer')],
    });
    expect(edge.data.label).toBe('d3f:connected-to ×2');
  });
});

describe('toCytoscapeElements — folding containers', () => {
  const G = (id) => `urn:d3fend-graph:${id}`;

  // svc holds db and log; db reads log inside it, both read sink outside it, and
  // client comes in from outside — one fixture for every re-anchoring case.
  const store = storeFromTurtle(`
    G:svc a d3f:Network ; rdfs:label "DB service" ; d3f:contains G:db, G:log .
    G:db a d3f:Database ; d3f:reads G:log ; d3f:reads G:sink .
    G:log a d3f:LogFile ; d3f:reads G:sink .
    G:client a d3f:Browser ; d3f:authenticates G:db .
    G:sink a d3f:WebServer .
  `);
  const model = buildGraphModel(store);
  const predicates = modelPredicates(model);

  const nodesOf = (elements) => elements.filter((e) => !e.data.source);
  const edgesOf = (elements) => elements.filter((e) => e.data.source);
  const render = (options) => {
    const { elements, stats } = toCytoscapeElements(model, filterState({ predicates, ...options }));
    return { stats, nodes: new Map(nodesOf(elements).map((e) => [e.data.id, e.data])), edges: edgesOf(elements) };
  };

  it('hides the contained nodes and draws the container as a plain node', () => {
    const { nodes } = render({ folded: ['svc'] });
    expect([...nodes.keys()].map(displayIdOf).sort()).toEqual(['client', 'sink', 'svc']);
    const svc = nodes.get(G('svc'));
    expect(svc.folded).toBe(true);
    // Still foldable — that is what keeps the chevron there to unfold it — but no
    // longer a compound, so it loses the label band and ELK's reserved padding.
    expect(svc.foldable).toBe(true);
    expect(svc.isContainer).toBeUndefined();
  });

  it('reports how many nodes it is standing in for', () => {
    // db and log, so the user can tell whether unfolding is worth it.
    expect(render({ folded: ['svc'] }).nodes.get(G('svc')).label).toBe('svc\nDB service\nd3f:Network\n▸ 2 nodes');
  });

  it('says nothing about a count while it is open', () => {
    expect(render({}).nodes.get(G('svc')).label).toBe('svc\nDB service\nd3f:Network');
  });

  it('marks an unfolded container as a compound that can be folded', () => {
    const svc = render({}).nodes.get(G('svc'));
    expect(svc).toMatchObject({ isContainer: true, foldable: true });
    expect(svc.folded).toBeUndefined();
  });

  it('re-anchors an outgoing link onto the folded container', () => {
    // :svc contains :db, :db reads :sink → folded :svc reads :sink.
    const edge = render({ folded: ['svc'] }).edges.find((e) => e.data.predicate === 'd3f:reads');
    expect(edge.data).toMatchObject({ source: G('svc'), target: G('sink'), derived: true });
  });

  it('re-anchors an incoming link onto the folded container', () => {
    // :svc contains :db, :client authenticates :db → :client authenticates :svc.
    const edge = render({ folded: ['svc'] }).edges.find((e) => e.data.predicate === 'd3f:authenticates');
    expect(edge.data).toMatchObject({ source: G('client'), target: G('svc'), derived: true });
  });

  it('drops a link whose two ends are inside the same fold', () => {
    // :db reads :log is internal detail, which is what folding hides.
    const { edges } = render({ folded: ['svc'] });
    expect(edges.some((e) => e.data.source === e.data.target)).toBe(false);
    expect(edges.length).toBe(2);
  });

  it('merges the child links that collapse onto the same pair, and counts them', () => {
    // Both :db and :log read :sink: one edge, not two beziers over each other.
    const reads = render({ folded: ['svc'] }).edges.filter((e) => e.data.predicate === 'd3f:reads');
    expect(reads.length).toBe(1);
    expect(reads[0].data.foldedCount).toBe(2);
    expect(reads[0].data.label).toBe('d3f:reads ×2');
    expect(reads[0].data.foldedFrom.map(displayIdOf).sort()).toEqual(['db', 'log']);
    expect(reads[0].data.foldedTo.map(displayIdOf)).toEqual(['sink']);
  });

  it('keeps a derived link inverted and classified like the triple behind it', () => {
    const asserted = render({}).edges.find((e) => e.data.predicate === 'd3f:authenticates');
    const edge = render({ folded: ['svc'] }).edges.find((e) => e.data.predicate === 'd3f:authenticates');
    // Folding does not change the predicate, so the kind is whatever the
    // unfolded link got, and tap-to-invert still applies.
    expect(edge.data).toMatchObject({ kind: asserted.data.kind, invertible: true, foldedCount: 1 });
    // A single collapsed link is derived, but carries no count in its label.
    expect(edge.data.label).toBe('d3f:authenticates');
  });

  it('leaves an untouched link asserted, with no count and no dash', () => {
    const edge = render({}).edges.find((e) => e.data.predicate === 'd3f:authenticates');
    expect(edge.data.derived).toBeUndefined();
    expect(edge.data.foldedCount).toBeUndefined();
    expect(edge.data.label).toBe('d3f:authenticates');
  });

  it('counts what it emitted, so the chips report the folded picture', () => {
    expect(render({}).stats).toEqual({ nodesShown: 5, nodesTotal: 5, edgesShown: 4, edgesTotal: 4 });
    // svc replaces db and log; :db reads :log is gone and the two reads merged.
    expect(render({ folded: ['svc'] }).stats).toEqual({
      nodesShown: 3,
      nodesTotal: 5,
      edgesShown: 2,
      edgesTotal: 4,
    });
  });

  it('ignores a folded IRI that no longer matches a node', () => {
    // Left over in localStorage from another example.
    const stale = render({ folded: ['gone'] });
    expect(stale.stats).toEqual(render({}).stats);
    expect([...stale.nodes.values()].some((data) => data.folded)).toBe(false);
  });

  it('ignores a fold whose children were all filtered out', () => {
    // Nothing left to hide, so no fold marker over an empty container.
    const emptied = buildGraphModel(storeFromTurtle(`
      G:team a d3f:User ; d3f:contains G:page .
      G:page a d3f:Browser .
    `));
    const { elements } = toCytoscapeElements(
      emptied,
      filterState({ nodeKinds: ['actors'], folded: ['team'] }),
    );
    const team = elements.find((e) => e.data.id === G('team')).data;
    expect(team.folded).toBeUndefined();
    expect(team.foldable).toBeUndefined();
    expect(team.isContainer).toBeUndefined();
  });

  describe('nested containers', () => {
    const nested = buildGraphModel(storeFromTurtle(`
      G:outer a d3f:Network ; d3f:contains G:mid .
      G:mid a d3f:Network ; d3f:contains G:leaf .
      G:leaf a d3f:Browser ; d3f:reads G:sink .
      G:sink a d3f:WebServer .
    `));
    const renderNested = (options) => {
      const { elements } = toCytoscapeElements(nested, filterState({ predicates: ['d3f:reads'], ...options }));
      return {
        nodes: new Map(elements.filter((e) => !e.data.source).map((e) => [e.data.id, e.data])),
        edges: elements.filter((e) => e.data.source),
      };
    };

    it('draws the outermost fold when a fold sits inside a fold', () => {
      const { nodes, edges } = renderNested({ folded: ['outer', 'mid'] });
      expect([...nodes.keys()].map(displayIdOf).sort()).toEqual(['outer', 'sink']);
      expect(edges[0].data.source).toBe(G('outer'));
    });

    it('counts every node inside the fold, not just the direct children', () => {
      // outer holds mid holds leaf, so folding outer hides two, one of them a
      // container in its own right.
      const { nodes } = renderNested({ folded: ['outer', 'mid'] });
      expect(nodes.get(G('outer')).label).toBe('outer\nd3f:Network\n▸ 2 nodes');
    });

    it('says "node", not "nodes", when it hides exactly one', () => {
      const { nodes } = renderNested({ folded: ['mid'] });
      expect(nodes.get(G('mid')).label).toBe('mid\nd3f:Network\n▸ 1 node');
    });

    it('keeps a folded container inside the unfolded one that holds it', () => {
      const { nodes, edges } = renderNested({ folded: ['mid'] });
      expect([...nodes.keys()].map(displayIdOf).sort()).toEqual(['mid', 'outer', 'sink']);
      expect(nodes.get(G('mid'))).toMatchObject({ folded: true, parent: G('outer') });
      expect(nodes.get(G('outer'))).toMatchObject({ isContainer: true });
      expect(edges[0].data.source).toBe(G('mid'));
    });

    it('resurfaces the children of a folded container the node filter removed', () => {
      // outer survives, mid does not: the fold on mid cannot apply, and leaf
      // reparents onto outer exactly as it does for a plain hidden container.
      const filtered = buildGraphModel(storeFromTurtle(`
        G:outer a d3f:Network ; d3f:contains G:mid .
        G:mid a d3f:User ; d3f:contains G:leaf .
        G:leaf a d3f:Browser .
      `));
      const { elements } = toCytoscapeElements(
        filtered,
        filterState({ nodeKinds: ['artifacts'], folded: ['mid'] }),
      );
      const leaf = elements.find((e) => e.data.id === G('leaf'));
      expect(leaf.data.parent).toBe(G('outer'));
    });
  });
});

describe('toCytoscapeElements — collapsing artifact-mediated paths', () => {
  const G = (id) => `urn:d3fend-graph:${id}`;
  const ON = { collapseArtifactPaths: true };

  const modelOf = (turtle) => buildGraphModel(storeFromTurtle(turtle));
  const render = (model, options = {}, viewOptions = ON) => {
    const { elements, stats } = toCytoscapeElements(
      model,
      filterState({ predicates: modelPredicates(model), ...options }),
      viewOptions,
    );
    return {
      stats,
      nodes: new Map(elements.filter((e) => !e.data.source).map((e) => [e.data.id, e.data])),
      edges: elements.filter((e) => e.data.source).map((e) => e.data),
    };
  };

  // The shape the feature exists for: a request reified as a node between the two
  // parties that exchange it. `d3f:executes` puts the consumer on the *subject*
  // end, so this also covers the non-`-by` orientation.
  const exchange = modelOf(`
    G:client a d3f:Browser ; d3f:produces G:request .
    G:request a d3f:WebResourceAccess ; rdfs:label "HTTP request" .
    G:api a d3f:WebApplication ; d3f:executes G:request .
  `);

  it('draws one arrow between the two parties and no payload node', () => {
    const { nodes, edges } = render(exchange);
    expect([...nodes.keys()].map(displayIdOf).sort()).toEqual(['api', 'client']);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: G('client'), target: G('api') });
  });

  it('labels the arrow with the payload, which is what it removed from the drawing', () => {
    expect(render(exchange).edges[0].label).toBe('HTTP request');
  });

  it('falls back to the payload id when it carries no rdfs:label', () => {
    const unlabelled = modelOf(`
      G:client a d3f:Browser ; d3f:produces G:request .
      G:request a d3f:WebResourceAccess .
      G:api a d3f:WebApplication ; d3f:executes G:request .
    `);
    expect(render(unlabelled).edges[0].label).toBe('request');
  });

  it('records both written triples, each with its own predicate', () => {
    expect(render(exchange).edges[0].standsFor).toEqual([
      { from: G('client'), predicate: 'd3f:produces', to: G('request') },
      { from: G('api'), predicate: 'd3f:executes', to: G('request') },
    ]);
  });

  it('marks the arrow derived, collapsed, data-flow and not swappable', () => {
    expect(render(exchange).edges[0]).toMatchObject({
      derived: true,
      collapsed: true,
      kind: 'data-flow',
      invertible: false,
      payload: G('request'),
      payloadLabel: 'HTTP request',
    });
    // foldedFrom/foldedTo cannot express two predicates, so they are not used.
    expect(render(exchange).edges[0].foldedFrom).toBeUndefined();
  });

  it('changes nothing at all when the preference is off', () => {
    const { nodes, edges, stats } = render(exchange, {}, {});
    expect([...nodes.keys()].map(displayIdOf).sort()).toEqual(['api', 'client', 'request']);
    expect(edges).toHaveLength(2);
    expect(stats).toEqual({ nodesShown: 3, nodesTotal: 3, edgesShown: 2, edgesTotal: 2 });
  });

  it('counts what it drew, so the chips report the collapsed picture', () => {
    // The payload is gone and its two links are one arrow; the store still has both.
    expect(render(exchange).stats).toEqual({
      nodesShown: 2,
      nodesTotal: 3,
      edgesShown: 1,
      edgesTotal: 2,
    });
  });

  it('is not flipped by swapping either leg to its inverse', () => {
    // The synthetic predicate is not one anybody can invert, which is what keeps
    // `s` (docs/adr/0019-select-and-swap-edges.md) from changing what collapses.
    const direction = new Map([
      ['d3f:produces', 'inverse'],
      ['d3f:executes', 'inverse'],
    ]);
    const edge = render(exchange, { direction }).edges[0];
    expect(edge).toMatchObject({ source: G('client'), target: G('api'), label: 'HTTP request' });
  });

  describe('request and response', () => {
    // The user's own diagram: two payloads between the same pair, one each way.
    const both = modelOf(`
      G:client a d3f:Browser ; d3f:produces G:requests .
      G:requests a d3f:WebResourceAccess ; rdfs:label "HTTP Requests" .
      G:api a d3f:WebApplication ; d3f:executes G:requests ; d3f:produces G:responses .
      G:responses a d3f:WebResourceAccess ; rdfs:label "HTTP Responses" ; d3f:accessed-by G:client .
    `);

    it('stays two arrows rather than merging into one two-way link', () => {
      const { edges } = render(both);
      expect(edges).toHaveLength(2);
      expect(edges.every((e) => e.bidirectional === undefined)).toBe(true);
      expect(edges.map((e) => `${displayIdOf(e.source)}->${displayIdOf(e.target)}:${e.label}`).sort()).toEqual([
        'api->client:HTTP Responses',
        'client->api:HTTP Requests',
      ]);
    });

    it('leaves only the two parties on screen', () => {
      expect([...render(both).nodes.keys()].map(displayIdOf).sort()).toEqual(['api', 'client']);
    });
  });

  describe('what it refuses', () => {
    it('refuses a payload that carries any other link', () => {
      const hardened = modelOf(`
        G:client a d3f:Browser ; d3f:produces G:request .
        G:request a d3f:WebResourceAccess .
        G:api a d3f:WebApplication ; d3f:executes G:request .
        G:tls a d3f:Browser ; d3f:encrypts G:request .
      `);
      const { nodes, edges } = render(hardened);
      expect(nodes.has(G('request'))).toBe(true);
      expect(edges.some((e) => e.collapsed)).toBe(false);
    });

    it('refuses a self-loop rather than reading it as a hop', () => {
      // Without the self-loop this collapses; with it, the payload has a link that
      // is not one of its two legs, and one is enough to refuse.
      const loop = modelOf(`
        G:cache a d3f:File ; d3f:produces G:cache .
        G:client a d3f:Browser ; d3f:produces G:cache .
        G:reader a d3f:Browser ; d3f:reads G:cache .
      `);
      const { nodes, edges } = render(loop);
      expect(nodes.has(G('cache'))).toBe(true);
      expect(edges.some((e) => e.collapsed)).toBe(false);
    });

    it('refuses when one party is on both ends', () => {
      // A scratch file a process writes and reads back is not a message.
      const scratch = modelOf(`
        G:job a d3f:Browser ; d3f:produces G:tmp ; d3f:reads G:tmp .
        G:tmp a d3f:File .
      `);
      const { nodes, edges } = render(scratch);
      expect(nodes.has(G('tmp'))).toBe(true);
      expect(edges.some((e) => e.collapsed)).toBe(false);
    });

    it('refuses a payload with children, which would leave the graph with them', () => {
      const bundle = modelOf(`
        G:build a d3f:Browser ; d3f:produces G:bundle .
        G:bundle a d3f:File ; d3f:contains G:manifest .
        G:manifest a d3f:File .
        G:deploy a d3f:Browser ; d3f:reads G:bundle .
      `);
      expect(render(bundle).nodes.has(G('bundle'))).toBe(true);
    });

    it('refuses an actor, whatever its links say', () => {
      const person = modelOf(`
        G:hr a d3f:Browser ; d3f:produces G:alice .
        G:alice a d3f:User .
        G:payroll a d3f:Browser ; d3f:reads G:alice .
      `);
      expect(render(person).nodes.has(G('alice'))).toBe(true);
    });

    it('refuses when both sides fan out, since that draws more arrows than it removes', () => {
      const shared = modelOf(`
        G:p1 a d3f:Browser ; d3f:produces G:bus .
        G:p2 a d3f:Browser ; d3f:produces G:bus .
        G:bus a d3f:File ; d3f:accessed-by G:c1, G:c2 .
        G:c1 a d3f:Browser .
        G:c2 a d3f:Browser .
      `);
      const { nodes, edges } = render(shared);
      expect(nodes.has(G('bus'))).toBe(true);
      expect(edges.some((e) => e.collapsed)).toBe(false);
    });

    it('refuses when a filter has already hidden one of the two legs', () => {
      // The payload is drawn with its surviving link rather than vanishing: the
      // Links chip stays authoritative over what the collapse may consume.
      const { nodes, edges } = render(exchange, { predicates: ['d3f:executes'] });
      expect(nodes.has(G('request'))).toBe(true);
      expect(edges).toHaveLength(1);
      expect(edges[0].collapsed).toBeUndefined();
    });

    it('does nothing when the data-flow kind is hidden', () => {
      const { nodes, edges } = render(exchange, { kinds: ['control-flow', 'other'] });
      expect(nodes.has(G('request'))).toBe(true);
      expect(edges).toEqual([]);
    });
  });

  describe('fan-out and fan-in', () => {
    it('draws one arrow per consumer and still removes the payload', () => {
      const broadcast = modelOf(`
        G:p0 a d3f:Browser ; d3f:produces G:d1 .
        G:d1 a d3f:File ; rdfs:label "batch" ; d3f:accessed-by G:p1, G:p2 .
        G:p1 a d3f:Browser .
        G:p2 a d3f:Browser .
      `);
      const { nodes, edges } = render(broadcast);
      expect(nodes.has(G('d1'))).toBe(false);
      expect(edges).toHaveLength(2);
      expect(edges.every((e) => e.label === 'batch' && e.source === G('p0'))).toBe(true);
      expect(edges.map((e) => displayIdOf(e.target)).sort()).toEqual(['p1', 'p2']);
    });

    it('draws one arrow per producer for a fan-in', () => {
      const merge = modelOf(`
        G:p1 a d3f:Browser ; d3f:produces G:d1 .
        G:p2 a d3f:Browser ; d3f:produces G:d1 .
        G:d1 a d3f:File ; rdfs:label "batch" ; d3f:accessed-by G:sink .
        G:sink a d3f:Browser .
      `);
      const { nodes, edges } = render(merge);
      expect(nodes.has(G('d1'))).toBe(false);
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => displayIdOf(e.source)).sort()).toEqual(['p1', 'p2']);
      expect(edges.every((e) => e.target === G('sink'))).toBe(true);
    });

    it('leaves the ends of a pipeline drawn and collapses only what is between them', () => {
      const pipeline = modelOf(`
        G:d0 a d3f:File ; d3f:accessed-by G:p0 .
        G:p0 a d3f:Browser ; d3f:produces G:d1 .
        G:d1 a d3f:File ; d3f:accessed-by G:p1 .
        G:p1 a d3f:Browser ; d3f:produces G:store .
        G:store a d3f:File .
      `);
      const { nodes } = render(pipeline);
      // d0 has no producer and store no consumer, so both are endpoints, not
      // payloads. Only d1 sits between two parties.
      expect([...nodes.keys()].map(displayIdOf).sort()).toEqual(['d0', 'p0', 'p1', 'store']);
    });
  });

  describe('together with folded containers', () => {
    const contained = modelOf(`
      G:dc a d3f:Network ; rdfs:label "dc-1" ; d3f:contains G:binlog, G:service .
      G:service a d3f:DatabaseService ; d3f:produces G:binlog .
      G:binlog a d3f:File ; rdfs:label "binlog" .
      G:sync a d3f:DatabaseService ; d3f:reads G:binlog .
    `);

    it('collapses a payload that lives inside a container', () => {
      const { nodes, edges } = render(contained);
      expect(nodes.has(G('binlog'))).toBe(false);
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({ source: G('service'), target: G('sync'), label: 'binlog' });
    });

    it('stops drawing a container the collapse emptied', () => {
      const onlyChild = modelOf(`
        G:box a d3f:Network ; d3f:contains G:msg .
        G:sender a d3f:Browser ; d3f:produces G:msg .
        G:msg a d3f:File .
        G:receiver a d3f:Browser ; d3f:reads G:msg .
      `);
      const box = render(onlyChild).nodes.get(G('box'));
      expect(box.isContainer).toBeUndefined();
      expect(box.foldable).toBeUndefined();
    });

    it('re-anchors the collapsed arrow onto a folded container', () => {
      const { nodes, edges } = render(contained, { folded: ['dc'] });
      // dc is folded, so the payload's ancestor is folded and the payload itself is
      // not collapsed — its legs are re-anchored onto dc instead.
      expect(nodes.has(G('binlog'))).toBe(false);
      expect(edges.every((e) => e.collapsed === undefined)).toBe(true);
      expect(edges.map((e) => `${displayIdOf(e.source)}->${displayIdOf(e.target)}`)).toEqual(['sync->dc']);
    });
  });
});
