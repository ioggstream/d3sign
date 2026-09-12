import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Parser } from 'n3';
import { GraphStore } from '../src/rdf/store.js';
import { buildGraphModel } from '../src/rdf/graphModel.js';
import {
  FLOW_POLARITY_PREDICATES,
  flowPolarityOf,
  isSequencePredicate,
} from '../src/rdf/flowPolarity.js';
import { inversePredicateOf } from '../src/rdf/emit.js';
import { classifyPredicate } from '../src/rdf/linkKind.js';
import { toCytoscapeElements } from '../src/viz/toCytoscape.js';

const ORIENTED = { orientByFlow: true };

/**
 * Every cycle-forming arrow in a drawn graph, by depth-first search.
 *
 * The point of the whole feature is that the oriented graph is a DAG: a layered
 * layout given a cycle has to reverse an edge to break it, and that reversal is
 * the zig-zag. Reported as the offending arrows rather than as a count, so a
 * regression names the predicate that put the cycle there.
 */
function cyclesIn(arrows) {
  const out = new Map();
  for (const arrow of arrows) {
    const source = arrow.slice(0, arrow.indexOf(' '));
    const target = arrow.slice(arrow.lastIndexOf(' ') + 1);
    if (source === target) continue;
    if (!out.has(source)) out.set(source, []);
    out.get(source).push({ target, arrow });
  }
  const state = new Map();
  const back = [];
  const visit = (node) => {
    state.set(node, 'open');
    for (const { target, arrow } of out.get(node) ?? []) {
      const seen = state.get(target);
      if (seen === 'open') back.push(arrow);
      else if (seen === undefined) visit(target);
    }
    state.set(node, 'done');
  };
  for (const node of out.keys()) if (!state.has(node)) visit(node);
  return back;
}

/** A filter state that hides nothing, so a case only exercises the orientation. */
function passThrough(model, { direction = new Map() } = {}) {
  return {
    visiblePredicates: new Set(model.edges.map((e) => e.predicate)),
    visibleKinds: new Set(model.edges.map((e) => e.kind)),
    direction,
    foldedNodes: new Set(),
  };
}

function modelOf(turtle) {
  const store = new GraphStore();
  store.addQuads(
    new Parser().parse(`
      @prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
      @prefix G: <urn:d3fend-graph:> .
      ${turtle}
    `),
  );
  return buildGraphModel(store);
}

/** The drawn arrows as `source predicate target`, with the ids shortened. */
function arrowsOf(model, viewOptions, filterState = passThrough(model)) {
  const short = (iri) => iri.replace('urn:d3fend-graph:', '');
  return toCytoscapeElements(model, filterState, viewOptions)
    .elements.filter((el) => el.data.source)
    .map((el) => `${short(el.data.source)} ${el.data.label} ${short(el.data.target)}`)
    .sort();
}

describe('flowPolarityOf', () => {
  it('draws a link as written when the subject is the upstream party', () => {
    expect(flowPolarityOf('d3f:produces')).toBe('forward');
    expect(flowPolarityOf('d3f:accesses')).toBe('forward');
    expect(flowPolarityOf('d3f:precedes')).toBe('forward');
  });

  it('draws it backwards when the subject is the provider', () => {
    expect(flowPolarityOf('d3f:executes')).toBe('reverse');
    expect(flowPolarityOf('d3f:manages')).toBe('reverse');
    expect(flowPolarityOf('d3f:accessed-by')).toBe('reverse');
  });

  it('splits d3f:reads from d3f:executes, which no other axis does', () => {
    // Both are CONSUMING_ONTO_OBJECT (rdf/artifactFlow.js) and both
    // reading/object (rdf/predicateEffect.js), yet a reader depends on what it
    // reads while a database is depended *on* by the query it executes. That
    // pull-versus-push line is the whole reason this table is curated rather
    // than derived, so it is asserted rather than left to be rediscovered.
    expect(flowPolarityOf('d3f:reads')).toBe('forward');
    expect(flowPolarityOf('d3f:executes')).toBe('reverse');
  });

  it('splits the message pair, which is asserted from the message', () => {
    // `message d3f:has-sender agent` and `message d3f:has-recipient agent` are
    // both written from the payload, so the sender is upstream of the subject
    // and the recipient downstream of it.
    expect(flowPolarityOf('d3f:has-sender')).toBe('reverse');
    expect(flowPolarityOf('d3f:has-recipient')).toBe('forward');
  });

  it('is null for a predicate that states no direction of travel', () => {
    // The corpus writes d3f:runs host→process while ADR 0034 writes it
    // process→service. A predicate used both ways carries no polarity.
    expect(flowPolarityOf('d3f:runs')).toBeNull();
    // Symmetric: their own inverse in inverse-map.json.
    expect(flowPolarityOf('d3f:connected-to')).toBeNull();
    expect(flowPolarityOf('d3f:communicates-with')).toBeNull();
    // A role in an event, not a position in a sequence.
    expect(flowPolarityOf('d3f:has-participant')).toBeNull();
    // Lifecycle and tactical verbs end or act on a payload rather than move it.
    expect(flowPolarityOf('d3f:modifies')).toBeNull();
    expect(flowPolarityOf('d3f:hardens')).toBeNull();
    // Containment reaches the view as a compound parent, never as an arrow.
    expect(flowPolarityOf('d3f:contains')).toBeNull();
    expect(flowPolarityOf('d3f:whatever')).toBeNull();
  });

  it('gives every listed predicate exactly one polarity', () => {
    for (const curie of FLOW_POLARITY_PREDICATES) {
      expect(['forward', 'reverse'], curie).toContain(flowPolarityOf(curie));
    }
  });
});

describe('the polarity table against the rest of the vocabulary', () => {
  it('only names predicates that exist in D3FEND', () => {
    // The same guard the other three axes carry: the inverse names in
    // inverse-map.json are display labels the edge swap invents, so a table
    // about which way to *draw* a link cannot be keyed on them
    // (docs/adr/0019-select-and-swap-edges.md).
    const completions = JSON.parse(
      readFileSync(new URL('../src/data/d3fend-completions.json', import.meta.url), 'utf8'),
    );
    for (const curie of FLOW_POLARITY_PREDICATES) {
      const item = completions[curie.slice('d3f:'.length)];
      expect(item, curie).toBeTruthy();
      expect(item.kind, curie).toBe('property');
    }
  });

  it('gives every reversed predicate an inverse name to be drawn with', () => {
    // Without one the link stays as written, which is correct but silent: the
    // entry would look active in the table and do nothing in the drawing.
    for (const curie of FLOW_POLARITY_PREDICATES) {
      if (flowPolarityOf(curie) !== 'reverse') continue;
      expect(inversePredicateOf(curie), curie).toBeTruthy();
    }
  });

  it('keeps the sequence predicate out of the `other` bucket', () => {
    // It is the most frequent predicate in the CAD corpus; leaving it
    // unclassified let the Links chip switch off the sequence an attack graph
    // is about.
    expect(classifyPredicate('d3f:precedes')).toBe('control-flow');
    expect(isSequencePredicate('d3f:precedes')).toBe(true);
    expect(isSequencePredicate('d3f:accesses')).toBe(false);
  });
});

describe('buildGraphModel', () => {
  it('carries the polarity and the sequence flag on every edge', () => {
    const { edges } = modelOf('G:a a d3f:Browser ; d3f:manages G:b ; d3f:precedes G:c .');
    const manages = edges.find((e) => e.predicate === 'd3f:manages');
    expect(manages.flowPolarity).toBe('reverse');
    expect(manages.sequence).toBe(false);
    const precedes = edges.find((e) => e.predicate === 'd3f:precedes');
    expect(precedes.flowPolarity).toBe('forward');
    expect(precedes.sequence).toBe(true);
  });
});

describe('toCytoscapeElements — orienting along the flow', () => {
  // The four links of docs/adr/0035-improve-flow-discovery.md. Written as they
  // are, two of the four arrows point against the reading.
  const EXAMPLE = `
    G:proxy a d3f:ProxyServer ; d3f:accesses G:resource .
    G:app a d3f:WebServerApplication ; d3f:manages G:resource ; d3f:produces G:query .
    G:db a d3f:DatabaseServer ; d3f:executes G:query .
  `;

  it('leaves every link as written when the preference is off', () => {
    expect(arrowsOf(modelOf(EXAMPLE), {})).toEqual([
      'app d3f:manages resource',
      'app d3f:produces query',
      'db d3f:executes query',
      'proxy d3f:accesses resource',
    ]);
  });

  it('turns the four links into one left-to-right chain', () => {
    expect(arrowsOf(modelOf(EXAMPLE), ORIENTED)).toEqual([
      'app d3f:produces query',
      'proxy d3f:accesses resource',
      'query d3f:executed-by db',
      'resource d3f:managed-by app',
    ]);
  });

  it('is acyclic once oriented, which is what the layout needs', () => {
    expect(cyclesIn(arrowsOf(modelOf(EXAMPLE), ORIENTED))).toEqual([]);
  });

  it('lets an explicit swap win, in both directions', () => {
    const model = modelOf(EXAMPLE);
    // The user swaps a link the flow had already reoriented: it goes back to
    // being drawn as written and stays there. `??` rather than `||` in
    // toCytoscape.js is what makes a recorded 'forward' mean "the user chose
    // this" rather than "nothing recorded".
    const back = passThrough(model, { direction: new Map([['d3f:manages', 'forward']]) });
    expect(arrowsOf(model, ORIENTED, back)).toContain('app d3f:manages resource');
    // And the other way: a link the flow left alone is still swappable.
    const flipped = passThrough(model, { direction: new Map([['d3f:produces', 'inverse']]) });
    expect(arrowsOf(model, ORIENTED, flipped)).toContain('query d3f:produced-by app');
  });

  it('leaves a reversed predicate alone when it has no inverse name', () => {
    // Nothing is dropped and nothing is drawn under a name no vocabulary
    // defines. Asserted with a stand-in so the case survives inverse-map.json
    // gaining an entry.
    const model = modelOf('G:a a d3f:Browser ; d3f:executes G:b .');
    model.edges[0].inverse = null;
    expect(arrowsOf(model, ORIENTED)).toEqual(['a d3f:executes b']);
  });

  it('carries the sequence flag onto the drawn element', () => {
    // viz/layouts.js reads it off the element to keep an ordering edge out of
    // ELK's cycle breaking, and may not look up the predicate itself.
    const model = modelOf('G:a a d3f:Browser ; d3f:precedes G:b ; d3f:accesses G:c .');
    const drawn = toCytoscapeElements(model, passThrough(model), ORIENTED).elements.filter(
      (el) => el.data.source,
    );
    expect(drawn.find((el) => el.data.predicate === 'd3f:precedes').data.sequence).toBe(true);
    expect(drawn.find((el) => el.data.predicate === 'd3f:accesses').data.sequence).toBeUndefined();
  });
});

