import { describe, it, expect } from 'vitest';
import { addButtonTitle, groupRelations } from '../src/viz/nodePanel.js';
import { ADDED_MARKER } from '../src/editor/insertMeasure.js';
import d3fendMetadata from '../src/data/d3fend-metadata.json';

const relation = (over = {}) => ({
  predicate: 'd3f:hardens',
  direction: 'out',
  targetLocalName: 'Credential',
  kind: 'defense',
  ...over,
});

describe('groupRelations', () => {
  it('keeps the three kinds apart', () => {
    const grouped = groupRelations([
      relation({ kind: 'attack', targetLocalName: 'T1078' }),
      relation({ kind: 'defense', targetLocalName: 'DecoyPersona' }),
      relation({ kind: 'related', targetLocalName: 'UserAccount' }),
    ]);
    expect(grouped.attack.map((r) => r.targetLocalName)).toEqual(['T1078']);
    expect(grouped.defense.map((r) => r.targetLocalName)).toEqual(['DecoyPersona']);
    expect(grouped.related.map((r) => r.targetLocalName)).toEqual(['UserAccount']);
  });

  it('shows a row of an unknown or missing kind rather than dropping it', () => {
    // A metadata file built before the three-way tagging existed still renders in
    // full: everything that is not an attack or a defensive technique is a plain
    // relation.
    const grouped = groupRelations([relation({ kind: undefined }), relation({ kind: 'mystery' })]);
    expect(grouped.related).toHaveLength(2);
    expect(grouped.attack).toEqual([]);
    expect(grouped.defense).toEqual([]);
  });

  it('handles a class with no relations at all', () => {
    expect(groupRelations()).toEqual({ attack: [], defense: [], related: [] });
  });
});

describe('addButtonTitle', () => {
  it('names both ends, the predicate and where the lines go', () => {
    const title = addButtonTitle(relation({ predicate: 'd3f:has-account', targetLocalName: 'UserAccount' }));
    expect(title).toContain('User Account (UserAccount)');
    expect(title).toContain('this d3f:has-account User Account (UserAccount)');
    expect(title).toContain(ADDED_MARKER);
  });

  it('reads an incoming relation from the other end', () => {
    const title = addButtonTitle(relation({ predicate: 'd3f:spoofs', direction: 'in', targetLocalName: 'DecoyPersona' }));
    expect(title).toContain('Decoy Persona (DecoyPersona) d3f:spoofs this');
  });

  it('falls back to the local name for a class the metadata does not know', () => {
    expect(addButtonTitle(relation({ targetLocalName: 'NotAClass' }))).toContain('NotAClass (NotAClass)');
  });
});

describe('d3fend-metadata.json relations', () => {
  const relationsOf = (localName) => d3fendMetadata[localName].relations;
  const find = (localName, predicate, target) =>
    relationsOf(localName).filter((r) => r.predicate === predicate && r.targetLocalName === target);

  it('carries the relations d3fend.ttl states as OWL restrictions', () => {
    // d3f:User is not a DigitalArtifact and has a single direct-triple relation;
    // everything else it takes part in is stated as
    // `rdfs:subClassOf [ owl:onProperty … ; owl:someValuesFrom … ]`, which the build
    // now flattens the way the SPARQL pane does.
    expect(find('User', 'd3f:has-account', 'UserAccount')).toHaveLength(1);
    expect(find('User', 'd3f:restricted-by', 'AccessControlList')).toHaveLength(1);
    expect(find('User', 'd3f:authenticates', 'Authentication')[0]).toMatchObject({
      direction: 'in',
    });
  });

  it('states a relation once even when the ontology asserts it twice', () => {
    // `DecoyPersona d3f:spoofs User` is both a direct triple and a restriction.
    expect(find('User', 'd3f:spoofs', 'DecoyPersona')).toEqual([
      { predicate: 'd3f:spoofs', direction: 'in', targetLocalName: 'DecoyPersona', kind: 'defense' },
    ]);
  });

  it('calls a relation a defense only when the other end is a d3f:DefensiveTechnique', () => {
    expect(find('User', 'd3f:spoofs', 'DecoyPersona')[0].kind).toBe('defense');
    // An account is an artifact, not a countermeasure — DEFENSE is not the bucket
    // for whatever is not an attack.
    expect(find('User', 'd3f:has-account', 'UserAccount')[0].kind).toBe('related');
    expect(find('User', 'd3f:restricted-by', 'AccessControlList')[0].kind).toBe('related');
  });

  it('tags an attack relation by the other end being an offensive technique', () => {
    const attacks = relationsOf('Credential').filter((r) => r.kind === 'attack');
    expect(attacks.length).toBeGreaterThan(0);
    // The same flag the graph colours red, so a row under ATTACK and a red node
    // cannot disagree about what an attack is.
    for (const r of attacks) expect(d3fendMetadata[r.targetLocalName].offensive).toBe(true);
  });

  it('flags offensive techniques, and nothing else, as offensive', () => {
    expect(d3fendMetadata['T1110.001'].offensive).toBe(true);
    // An abstract parent in the OffensiveTechnique closure carries no attack-id.
    expect(d3fendMetadata.ExecutionTechnique.offensive).toBe(true);
    // Absent rather than false, which is how the other 2789 classes stay small.
    expect(d3fendMetadata.DecoyPersona.offensive).toBeUndefined();
    expect(d3fendMetadata.User.offensive).toBeUndefined();
  });
});
