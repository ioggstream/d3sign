import { describe, it, expect } from 'vitest';
import {
  ADDED_MARKER,
  relationInsertion,
  relationNodeContent,
  relationNodeId,
} from '../src/editor/insertMeasure.js';
import { collectSourceLocations } from '../src/editor/sourceLocations.js';

const FILTERS = {
  predicate: 'd3f:filters',
  direction: 'in',
  targetLocalName: 'EmailFiltering',
  kind: 'defense',
};

const doc = (...lines) => ['```mermaid', 'graph TD', ...lines, '```'].join('\n');

/** The document as the editor would hold it once the change is applied. */
function applied(text, change) {
  expect(change).not.toBeNull();
  return text.slice(0, change.from) + change.insert + text.slice(change.from);
}

describe('relationNodeId', () => {
  it('lowercases the local name', () => {
    expect(relationNodeId('EmailFiltering')).toBe('emailfiltering');
  });

  it('keeps an ATT&CK id readable, since ID_RE has no dot', () => {
    expect(relationNodeId('T1548.001')).toBe('t1548_001');
    expect(relationNodeId('AML.TA0000')).toBe('aml_ta0000');
    expect(relationNodeId('Two-Factor')).toBe('two-factor');
  });

  it('suffixes until the id is free', () => {
    const taken = new Set(['emailfiltering', 'emailfiltering2']);
    expect(relationNodeId('EmailFiltering', taken)).toBe('emailfiltering3');
  });
});

describe('relationNodeContent', () => {
  it('names the class in words, not just by its id', () => {
    // The whole point for an ATT&CK technique: `t1110_001` alone says nothing.
    expect(relationNodeContent('T1110.001')).toBe('d3f:T1110.001 Password Guessing');
    expect(relationNodeContent('EmailFiltering')).toBe('d3f:EmailFiltering Email Filtering');
  });

  it('leaves out a label that only repeats the local name', () => {
    expect(relationNodeContent('Email')).toBe('d3f:Email');
  });

  it('says nothing but the class for a name the metadata does not know', () => {
    expect(relationNodeContent('NotAClass')).toBe('d3f:NotAClass');
  });

  it('quotes a label with parentheses and drops what would close the shape', () => {
    // 100 D3FEND labels carry brackets, quotes or parentheses — CWE titles mostly.
    // `]` would end the node early; parentheses only need the quotes mermaid
    // documents, which the node parser strips back off.
    const content = relationNodeContent('CWE-1189');
    expect(content).toBe('"d3f:CWE-1189 Improper Isolation of Shared Resources on System-on-a-Chip (SoC)"');
    expect(relationNodeContent('CWE-113')).not.toMatch(/[[\]{}|<>]/);
  });
});

describe('relationInsertion', () => {
  it('writes the marker, the node and its link below the anchor declaration', () => {
    const text = doc('email[mail d3f:Email]');
    expect(applied(text, relationInsertion(text, 'email', FILTERS))).toBe(
      doc(
        'email[mail d3f:Email]',
        ADDED_MARKER,
        'emailfiltering[d3f:EmailFiltering Email Filtering]',
        'emailfiltering -->|d3f:filters| email',
      ),
    );
  });

  it('orients an outgoing relation the other way', () => {
    const text = doc('ef[d3f:EmailFiltering]');
    const rel = { ...FILTERS, direction: 'out', targetLocalName: 'Email' };
    expect(applied(text, relationInsertion(text, 'ef', rel))).toBe(
      doc('ef[d3f:EmailFiltering]', ADDED_MARKER, 'email[d3f:Email]', 'ef -->|d3f:filters| email'),
    );
  });

  it('adds an attack and a plain restriction by the same rule as a defense', () => {
    // The kind decides which section the row is listed under, nothing else: a
    // threat model draws the attack a node is subject to and the account it has.
    const text = doc('cred[d3f:Credential]');
    const attack = { predicate: 'd3f:accesses', direction: 'in', targetLocalName: 'T1552', kind: 'attack' };
    expect(applied(text, relationInsertion(text, 'cred', attack))).toBe(
      doc(
        'cred[d3f:Credential]',
        ADDED_MARKER,
        't1552[d3f:T1552 Unsecured Credentials]',
        't1552 -->|d3f:accesses| cred',
      ),
    );

    const restriction = {
      predicate: 'd3f:has-account',
      direction: 'out',
      targetLocalName: 'UserAccount',
      kind: 'related',
    };
    expect(applied(text, relationInsertion(text, 'cred', restriction))).toBe(
      doc(
        'cred[d3f:Credential]',
        ADDED_MARKER,
        'useraccount[d3f:UserAccount User Account]',
        'cred -->|d3f:has-account| useraccount',
      ),
    );
  });

  it('keeps the anchor indentation, so an addition joins its subgraph', () => {
    const text = doc('subgraph dc[DC d3f:Network]', '  email[mail d3f:Email]', 'end');
    expect(applied(text, relationInsertion(text, 'email', FILTERS))).toBe(
      doc(
        'subgraph dc[DC d3f:Network]',
        '  email[mail d3f:Email]',
        `  ${ADDED_MARKER}`,
        '  emailfiltering[d3f:EmailFiltering Email Filtering]',
        '  emailfiltering -->|d3f:filters| email',
        'end',
      ),
    );
  });

  it('suffixes the id rather than reusing a node that is already written', () => {
    const text = doc('email[mail d3f:Email]', 'emailfiltering[d3f:EmailFiltering]');
    expect(applied(text, relationInsertion(text, 'email', FILTERS))).toBe(
      doc(
        'email[mail d3f:Email]',
        ADDED_MARKER,
        'emailfiltering2[d3f:EmailFiltering Email Filtering]',
        'emailfiltering2 -->|d3f:filters| email',
        'emailfiltering[d3f:EmailFiltering]',
      ),
    );
  });

  it('leaves the index untouched, so a second addition lands below the anchor too', () => {
    // The marker is a comment, and a comment-only line yields no source location
    // and no node id — otherwise the second insertion would anchor on it or the
    // ids would stop colliding.
    const text = doc('  email[mail d3f:Email]');
    const once = applied(text, relationInsertion(text, 'email', FILTERS));
    const index = collectSourceLocations(once);
    expect([...index.nodes.keys()].sort()).toEqual(['email', 'emailfiltering']);

    expect(applied(once, relationInsertion(once, 'email', FILTERS))).toBe(
      doc(
        '  email[mail d3f:Email]',
        `  ${ADDED_MARKER}`,
        '  emailfiltering2[d3f:EmailFiltering Email Filtering]',
        '  emailfiltering2 -->|d3f:filters| email',
        `  ${ADDED_MARKER}`,
        '  emailfiltering[d3f:EmailFiltering Email Filtering]',
        '  emailfiltering -->|d3f:filters| email',
      ),
    );
  });

  it('prefers the declaration over a mention on an edge', () => {
    const text = doc('router -->|d3f:related| email', 'email[mail d3f:Email]');
    expect(applied(text, relationInsertion(text, 'email', FILTERS))).toBe(
      doc(
        'router -->|d3f:related| email',
        'email[mail d3f:Email]',
        ADDED_MARKER,
        'emailfiltering[d3f:EmailFiltering Email Filtering]',
        'emailfiltering -->|d3f:filters| email',
      ),
    );
  });

  it('falls back to an edge line for an anchor that is never declared', () => {
    const text = doc('router -->|d3f:related| email');
    expect(applied(text, relationInsertion(text, 'email', FILTERS))).toBe(
      doc(
        'router -->|d3f:related| email',
        ADDED_MARKER,
        'emailfiltering[d3f:EmailFiltering Email Filtering]',
        'emailfiltering -->|d3f:filters| email',
      ),
    );
  });

  it('writes into the block that declares the anchor', () => {
    const text = [
      doc('n1[d3f:Network]'),
      '',
      '```mermaid',
      'graph TD',
      'email[mail d3f:Email]',
      '```',
    ].join('\n');
    expect(applied(text, relationInsertion(text, 'email', FILTERS))).toBe(
      [
        doc('n1[d3f:Network]'),
        '',
        '```mermaid',
        'graph TD',
        'email[mail d3f:Email]',
        ADDED_MARKER,
        'emailfiltering[d3f:EmailFiltering Email Filtering]',
        'emailfiltering -->|d3f:filters| email',
        '```',
      ].join('\n'),
    );
  });

  it('returns null for an anchor no mermaid block writes', () => {
    const text = doc('email[mail d3f:Email]');
    expect(relationInsertion(text, 'absent', FILTERS)).toBeNull();
    // Prose outside a block is not a diagram, so it is not an anchor either.
    expect(relationInsertion(`email is here\n${text}`, 'nowhere', FILTERS)).toBeNull();
  });

  it('returns null for an incomplete relation', () => {
    const text = doc('email[mail d3f:Email]');
    expect(relationInsertion(text, 'email', { predicate: 'd3f:filters' })).toBeNull();
    expect(relationInsertion(text, '', FILTERS)).toBeNull();
  });
});
