import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Parser } from 'n3';
import { GraphStore } from '../src/rdf/store.js';
import { buildGraphModel } from '../src/rdf/graphModel.js';
import { ARTIFACT_FLOW_PREDICATES, artifactFlowRoleOf } from '../src/rdf/artifactFlow.js';
import { classifyPredicate } from '../src/rdf/linkKind.js';

describe('artifactFlowRoleOf', () => {
  it('reads a producing link with the payload on the object end', () => {
    expect(artifactFlowRoleOf('d3f:produces')).toEqual({ role: 'producing', payloadEnd: 'object' });
    expect(artifactFlowRoleOf('d3f:writes')).toEqual({ role: 'producing', payloadEnd: 'object' });
  });

  it('reads the same relation written the other way round', () => {
    expect(artifactFlowRoleOf('d3f:produced-by')).toEqual({ role: 'producing', payloadEnd: 'subject' });
  });

  it('reads a consuming link on either end, since the -by form is not the only one', () => {
    // `d1 -->|d3f:accessed-by| p1` puts the consumer on the object end...
    expect(artifactFlowRoleOf('d3f:accessed-by')).toEqual({ role: 'consuming', payloadEnd: 'subject' });
    // ...and `api -->|d3f:executes| request` puts it on the subject end. Both are in
    // the examples, which is why a role is a predicate *and* an end.
    expect(artifactFlowRoleOf('d3f:executes')).toEqual({ role: 'consuming', payloadEnd: 'object' });
  });

  it('is null for a predicate that moves no payload', () => {
    // A modifier is not the producer of what the consumer reads, so composing
    // through it would claim a hop nobody wrote.
    expect(artifactFlowRoleOf('d3f:modifies')).toBeNull();
    expect(artifactFlowRoleOf('d3f:mediates-access-to')).toBeNull();
    expect(artifactFlowRoleOf('d3f:runs')).toBeNull();
    expect(artifactFlowRoleOf('d3f:hardens')).toBeNull();
    expect(artifactFlowRoleOf('d3f:contains')).toBeNull();
    expect(artifactFlowRoleOf('d3f:whatever')).toBeNull();
  });

  it('gives every predicate exactly one role', () => {
    for (const curie of ARTIFACT_FLOW_PREDICATES) {
      const role = artifactFlowRoleOf(curie);
      expect(role, curie).not.toBeNull();
      expect(['producing', 'consuming']).toContain(role.role);
      expect(['object', 'subject']).toContain(role.payloadEnd);
    }
  });
});

describe('the role tables against the rest of the vocabulary', () => {
  it('only names predicates that exist in D3FEND', () => {
    // The inverse names in rdf/inverse-map.json are display labels the edge swap
    // invents — `d3f:read-by` is not a property — so a role table must not be
    // seeded from them (docs/adr/0019-select-and-swap-edges.md).
    const completions = JSON.parse(
      readFileSync(new URL('../src/data/d3fend-completions.json', import.meta.url), 'utf8'),
    );
    for (const curie of ARTIFACT_FLOW_PREDICATES) {
      const item = completions[curie.slice('d3f:'.length)];
      expect(item, curie).toBeTruthy();
      expect(item.kind, curie).toBe('property');
    }
  });

  it('composes only data flow, so a collapsed path is honestly data-flow', () => {
    // The collapsed edge is hardcoded to kind 'data-flow' (viz/toCytoscape.js) and
    // the whole pass is gated on that kind being visible. Both are only honest
    // while every composable predicate classifies as data-flow — which also keeps
    // the tactical-verb colouring from ever firing on a collapsed arrow, since
    // classifyPredicate is a priority chain over disjoint tables.
    for (const curie of ARTIFACT_FLOW_PREDICATES) {
      expect(classifyPredicate(curie), curie).toBe('data-flow');
    }
  });
});

describe('buildGraphModel', () => {
  it('carries the role on every edge, resolved from the predicate as written', () => {
    // The seam that keeps viz/toCytoscape.js free of imports from the RDF layer
    // (docs/adr/0014-graph-view-from-rdf-only.md) and keys the roles on what was
    // written rather than on what is drawn.
    const store = new GraphStore();
    store.addQuads(
      new Parser().parse(`
        @prefix d3f: <http://d3fend.mitre.org/ontologies/d3fend.owl#> .
        @prefix G: <urn:d3fend-graph:> .
        G:a a d3f:Browser ; d3f:produces G:b ; d3f:hardens G:c .
      `),
    );
    const { edges } = buildGraphModel(store);
    expect(edges.find((e) => e.predicate === 'd3f:produces').flowRole).toEqual({
      role: 'producing',
      payloadEnd: 'object',
    });
    expect(edges.find((e) => e.predicate === 'd3f:hardens').flowRole).toBeNull();
  });
});
