import { describe, it, expect } from 'vitest';
import { buildSessionDump, dumpFileName, fenceFor } from '../src/query/sessionDump.js';

const NOW = Date.parse('2026-08-28T10:00:00.000Z');
const query = (over = {}) => ({ name: 'artifacts', sparql: 'ASK { ?s ?p ?o }', updatedAt: NOW, ...over });
const file = (over = {}) => ({ name: 'threat-model.md', content: '# Threat model\n', updatedAt: NOW, ...over });

describe('fenceFor', () => {
  it('uses three backticks for content that has none', () => {
    expect(fenceFor('SELECT *', 'sparql')).toEqual({ open: '```sparql', close: '```' });
  });

  it('outgrows a fence inside the content', () => {
    expect(fenceFor('a\n```\nb', 'markdown').close).toBe('````');
    expect(fenceFor('a\n`````\nb').close).toBe('``````');
  });

  it('outgrows inline code spans too, since a run is a run', () => {
    expect(fenceFor('`x` and ``y``').close).toBe('```');
    expect(fenceFor('```` a ````').close).toBe('`````');
  });

  it('treats missing content as empty', () => {
    expect(fenceFor(undefined).open).toBe('```');
  });
});

describe('buildSessionDump', () => {
  it('fences a query as sparql and a document as markdown', () => {
    const dump = buildSessionDump({ queries: [query()], files: [file()], now: NOW });
    expect(dump).toContain('### artifacts');
    expect(dump).toContain('```sparql\nASK { ?s ?p ?o }\n```');
    expect(dump).toContain('### threat-model.md');
    expect(dump).toContain('```markdown\n# Threat model\n```');
  });

  it('widens the fence around a document that contains one', () => {
    const dump = buildSessionDump({ files: [file({ content: 'see:\n\n```js\nx\n```\n' })], now: NOW });
    expect(dump).toContain('````markdown\n');
    expect(dump).toContain('\n````\n');
  });

  it('does not add a blank line before the closing fence', () => {
    const dump = buildSessionDump({ queries: [query({ sparql: 'ASK {}\n' })], now: NOW });
    expect(dump).toContain('```sparql\nASK {}\n```');
  });

  it('keeps the order it is given', () => {
    const dump = buildSessionDump({
      queries: [query({ name: 'newer' }), query({ name: 'older' })],
      now: NOW,
    });
    expect(dump.indexOf('### newer')).toBeLessThan(dump.indexOf('### older'));
  });

  it('omits a section that has nothing in it', () => {
    const dump = buildSessionDump({ queries: [query()], now: NOW });
    expect(dump).toContain('## SPARQL queries');
    expect(dump).not.toContain('## Documents');
  });

  it('says it is empty rather than emitting bare headings', () => {
    const dump = buildSessionDump({ now: NOW });
    expect(dump).toContain('Nothing was saved in this browser.');
    expect(dump).not.toContain('## SPARQL queries');
  });

  it('counts in the header, singular and plural', () => {
    expect(buildSessionDump({ queries: [query()], files: [file()], now: NOW })).toContain(
      '1 query, 1 document.',
    );
    expect(buildSessionDump({ queries: [query(), query()], now: NOW })).toContain(
      '2 queries, 0 documents.',
    );
  });
});

describe('dumpFileName', () => {
  it('is dated, so two dumps are told apart', () => {
    expect(dumpFileName(NOW)).toBe('d3sign-session-2026-08-28.md');
  });
});
