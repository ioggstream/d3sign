import { describe, it, expect } from 'vitest';
import { addButtonTitle, groupByAncestor, groupRelations, isLabelRedundant } from '../src/viz/nodePanel.js';
import { ADDED_MARKER } from '../src/editor/insertMeasure.js';
import { relationsFor } from '../src/editor/d3fendRestrictions.js';
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

describe('groupByAncestor', () => {
  it('separates what the class states from what it inherits', () => {
    const { own, inherited } = groupByAncestor([
      relation({ targetLocalName: 'Own' }),
      relation({ targetLocalName: 'Borrowed', via: 'Software' }),
    ]);
    expect(own.map((r) => r.targetLocalName)).toEqual(['Own']);
    expect(inherited).toEqual([
      { via: 'Software', rows: [expect.objectContaining({ targetLocalName: 'Borrowed' })] },
    ]);
  });

  it('buckets by ancestor, keeping first-seen order', () => {
    // relationsFor returns nearest ancestor first, so the buckets come out
    // most-specific first without this having to sort anything.
    const { inherited } = groupByAncestor([
      relation({ targetLocalName: 'A', via: 'Firewall' }),
      relation({ targetLocalName: 'B', via: 'ComputerPlatform' }),
      relation({ targetLocalName: 'C', via: 'Firewall' }),
    ]);
    expect(inherited.map((g) => g.via)).toEqual(['Firewall', 'ComputerPlatform']);
    expect(inherited[0].rows.map((r) => r.targetLocalName)).toEqual(['A', 'C']);
  });

  it('is empty on both sides for a class with nothing', () => {
    expect(groupByAncestor()).toEqual({ own: [], inherited: [] });
  });

  it('yields no groups when every relation is the class own', () => {
    expect(groupByAncestor([relation(), relation({ targetLocalName: 'Other' })]).inherited).toEqual([]);
  });

  it('yields no own rows when everything is inherited', () => {
    expect(groupByAncestor([relation({ via: 'Software' })]).own).toEqual([]);
  });

  it('survives an ancestor named like an Object property', () => {
    // A Map, not an object literal: `constructor` as a bucket key would
    // otherwise find Object.prototype's and append to it.
    const { inherited } = groupByAncestor([relation({ via: 'constructor' })]);
    expect(inherited).toHaveLength(1);
    expect(inherited[0].via).toBe('constructor');
  });

  it('splits d3f:WebApplicationFirewall the way the panel shows it', () => {
    // The reported case: a class that states nothing itself, so every row it
    // shows is inherited. Five of its nine ancestors state something, nearest
    // first - d3f:ApplicationLayerFirewall, d3f:ComputerNetworkNode,
    // d3f:DigitalInformationBearer and d3f:D3FENDCore state nothing, so they
    // contribute no group rather than an empty one.
    expect(d3fendMetadata.WebApplicationFirewall.relations).toEqual([]);
    const { own, inherited } = groupByAncestor(relationsFor('WebApplicationFirewall'));
    expect(own).toEqual([]);
    expect(inherited.map((g) => [g.via, g.rows.length])).toEqual([
      ['Firewall', 2],
      ['ComputerPlatform', 6],
      ['NetworkNode', 5],
      ['DigitalArtifact', 3],
      ['Artifact', 2],
    ]);
    expect(inherited.reduce((n, g) => n + g.rows.length, 0)).toBe(18);
    expect(inherited[0].rows.map((r) => r.predicate)).toEqual(['d3f:filters', 'd3f:disables']);
  });
});

describe('addButtonTitle', () => {
  it('names both ends, the predicate and where the lines go', () => {
    const title = addButtonTitle(relation({ predicate: 'd3f:has-account', targetLocalName: 'UserAccount' }));
    expect(title).toContain('User Account (UserAccount)');
    expect(title).toContain('this d3f:has-account User Account (UserAccount)');
    expect(title).toContain(ADDED_MARKER);
  });

  it('says where an inherited relation is stated, and says nothing when it is the class own', () => {
    // The row is otherwise indistinguishable from one D3FEND puts on this class
    // directly, and most rows on a leaf class are inherited.
    expect(addButtonTitle(relation({ via: 'Software' }))).toContain('D3FEND states it on d3f:Software');
    expect(addButtonTitle(relation())).not.toContain('D3FEND states it on');
  });

  it('reads an incoming relation from the other end', () => {
    const title = addButtonTitle(relation({ predicate: 'd3f:spoofs', direction: 'in', targetLocalName: 'DecoyPersona' }));
    expect(title).toContain('Decoy Persona (DecoyPersona) d3f:spoofs this');
  });

  it('falls back to the local name for a class the metadata does not know', () => {
    expect(addButtonTitle(relation({ targetLocalName: 'NotAClass' }))).toContain('NotAClass (NotAClass)');
  });
});

describe('isLabelRedundant', () => {
  it('is true when the label is the local name with spacing and case added', () => {
    expect(isLabelRedundant('File Eviction', 'FileEviction')).toBe(true);
  });

  it('is false when the label and local name share no text, as with ATT&CK ids', () => {
    expect(isLabelRedundant('Spearphishing', 'T1566')).toBe(false);
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
