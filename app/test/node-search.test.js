import { describe, it, expect } from 'vitest';
import { matchNodes } from '../src/viz/nodeSearch.js';

describe('matchNodes', () => {
  const records = [
    { id: 'g:db', displayId: 'db', name: 'Primary Database' },
    { id: 'g:backup-db', displayId: 'backup-db', name: 'Nightly Backup' },
    { id: 'g:web', displayId: 'web', name: 'Public Web App' },
    { id: 'g:plain', displayId: 'plain' },
  ];

  it('matches nothing for a blank query', () => {
    expect(matchNodes(records, '')).toEqual([]);
    expect(matchNodes(records, '   ')).toEqual([]);
    expect(matchNodes(records, null)).toEqual([]);
    expect(matchNodes(records, undefined)).toEqual([]);
  });

  it('matches a substring of the mermaid id, ignoring case', () => {
    expect(matchNodes(records, 'DB')).toEqual(['g:db', 'g:backup-db']);
  });

  it('matches a substring of the label', () => {
    expect(matchNodes(records, 'public')).toEqual(['g:web']);
  });

  it('ranks prefix hits above substring hits', () => {
    // `db` begins `db` and sits mid-string in `backup-db`.
    expect(matchNodes(records, 'db')).toEqual(['g:db', 'g:backup-db']);
  });

  it('ranks a prefix hit on either field above any substring hit', () => {
    const ranked = [
      { id: 'mid', displayId: 'xx-night', name: 'Other' },
      { id: 'byName', displayId: 'zzz', name: 'Nightly Backup' },
    ];
    expect(matchNodes(ranked, 'night')).toEqual(['byName', 'mid']);
  });

  it('prefers the id over the label when both hit the same way', () => {
    const tie = [
      { id: 'byLabel', displayId: 'zzz', name: 'alpha service' },
      { id: 'byId', displayId: 'alpha', name: 'Something Else' },
    ];
    expect(matchNodes(tie, 'alpha')).toEqual(['byId', 'byLabel']);
  });

  it('lists a node matching on both fields exactly once', () => {
    const both = [{ id: 'one', displayId: 'db', name: 'db cluster' }];
    expect(matchNodes(both, 'db')).toEqual(['one']);
  });

  it('keeps the given order between equally ranked nodes', () => {
    const same = [
      { id: 'first', displayId: 'node-a' },
      { id: 'second', displayId: 'node-b' },
      { id: 'third', displayId: 'node-c' },
    ];
    expect(matchNodes(same, 'node-')).toEqual(['first', 'second', 'third']);
  });

  it('survives a node with no label', () => {
    expect(matchNodes(records, 'plain')).toEqual(['g:plain']);
  });

  it('matches nothing when nothing contains the query', () => {
    expect(matchNodes(records, 'nowhere')).toEqual([]);
  });

  it('survives empty and missing input', () => {
    expect(matchNodes([], 'db')).toEqual([]);
    expect(matchNodes(undefined, 'db')).toEqual([]);
    expect(matchNodes([{ displayId: 'db' }], 'db')).toEqual([]);
  });
});
