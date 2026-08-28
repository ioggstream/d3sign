import { describe, it, expect } from 'vitest';
import {
  CONSTRUCT_GRAPH_CAP,
  adjustErrorPosition,
  bindSelection,
  parseQueryDoc,
  resultTable,
  resultTsv,
  termCell,
  usesThis,
} from '../src/query/resultModel.js';
import { queryPrefixes, preambleLineCount, withPreamble } from '../src/query/queryPrefixes.js';
import { KNOWLEDGE_BASES } from '../src/rdf/knowledgeBases.js';

const prefixes = queryPrefixes(KNOWLEDGE_BASES);

const iri = (value) => ({ termType: 'NamedNode', value });
const lit = (value, extra = {}) => ({ termType: 'Literal', value, ...extra });

describe('termCell', () => {
  it('shortens known IRIs to CURIEs and keeps the full IRI reachable', () => {
    const cell = termCell(iri('http://d3fend.mitre.org/ontologies/d3fend.owl#Credential'), { prefixes });
    expect(cell.text).toBe('d3f:Credential');
    expect(cell.title).toBe('http://d3fend.mitre.org/ontologies/d3fend.owl#Credential');
    expect(cell.kind).toBe('iri');
  });

  it('renders knowledge-base and query graph names with their own prefixes', () => {
    expect(termCell(iri('urn:d3fend-graph:kg:d3fend'), { prefixes }).text).toBe('K:d3fend');
    expect(termCell(iri('urn:d3fend-graph:query:coverage'), { prefixes }).text).toBe('Q:coverage');
  });

  it('prefers the longest matching prefix', () => {
    expect(termCell(iri('urn:d3fend-graph:enrichment:x'), { prefixes }).text).toBe('E:x');
    expect(termCell(iri('urn:d3fend-graph:db-1'), { prefixes }).text).toBe('G:db-1');
  });

  it('leaves an IRI with no matching prefix alone', () => {
    expect(termCell(iri('https://example.org/thing'), { prefixes }).text).toBe('https://example.org/thing');
  });

  it('marks only IRIs the graph view is drawing', () => {
    const knownNodes = new Set(['urn:d3fend-graph:db-1']);
    expect(termCell(iri('urn:d3fend-graph:db-1'), { prefixes, knownNodes }).inGraph).toBe(true);
    expect(termCell(iri('urn:d3fend-graph:absent'), { prefixes, knownNodes }).inGraph).toBe(false);
    // A literal is never revealable, even if its text matches a node id.
    expect(termCell(lit('urn:d3fend-graph:db-1'), { prefixes, knownNodes }).inGraph).toBe(false);
  });

  it('quotes literals, keeping language tags and non-plain datatypes', () => {
    expect(termCell(lit('Primary database'), { prefixes }).text).toBe('"Primary database"');
    expect(termCell(lit('ciao', { language: 'it' }), { prefixes }).text).toBe('"ciao"@it');
    expect(
      termCell(lit('7', { datatype: 'http://www.w3.org/2001/XMLSchema#integer' }), { prefixes }).text,
    ).toBe('"7"^^xsd:integer');
  });

  it('does not decorate xsd:string, which every plain literal carries', () => {
    const cell = termCell(lit('plain', { datatype: 'http://www.w3.org/2001/XMLSchema#string' }), { prefixes });
    expect(cell.text).toBe('"plain"');
  });

  it('renders blank nodes and unbound cells without pretending they are IRIs', () => {
    expect(termCell({ termType: 'BlankNode', value: 'b0' }, { prefixes }).text).toBe('_:b0');
    expect(termCell(undefined, { prefixes })).toMatchObject({ text: '', kind: 'unbound', iri: null });
  });
});

describe('resultTable', () => {
  it('lays a SELECT out in variable order, including unbound cells', () => {
    const table = resultTable(
      {
        kind: 'select',
        vars: ['artifact', 'label'],
        rows: [{ artifact: iri('urn:d3fend-graph:db-1'), label: lit('Primary database') }, { artifact: iri('urn:d3fend-graph:api') }],
        ms: 34,
      },
      { prefixes },
    );
    expect(table.columns).toEqual(['artifact', 'label']);
    expect(table.rows[0].map((c) => c.text)).toEqual(['G:db-1', '"Primary database"']);
    expect(table.rows[1].map((c) => c.text)).toEqual(['G:api', '']);
    expect(table.summary).toBe('2 rows · 34 ms');
  });

  it('says "1 row", not "1 rows"', () => {
    const table = resultTable({ kind: 'select', vars: ['x'], rows: [{ x: lit('a') }] }, { prefixes });
    expect(table.summary).toBe('1 row');
  });

  it('caps rendered rows and says so instead of quietly showing a prefix of them', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ x: lit(String(i)) }));
    const table = resultTable({ kind: 'select', vars: ['x'], rows }, { prefixes, rowCap: 5 });
    expect(table.rows).toHaveLength(5);
    expect(table.rowCount).toBe(20);
    expect(table.shown).toBe(5);
    expect(table.capped).toBe(true);
    expect(table.summary).toContain('showing first 5');
  });

  it('reports an engine-truncated result as incomplete', () => {
    const table = resultTable(
      { kind: 'select', vars: ['x'], rows: [{ x: lit('a') }], truncated: true, ms: 12 },
      { prefixes },
    );
    expect(table.truncated).toBe(true);
    expect(table.summary).toContain('incomplete');
  });

  it('renders ASK as a single boolean cell', () => {
    const table = resultTable({ kind: 'ask', boolean: false, ms: 3 }, { prefixes });
    expect(table.kind).toBe('ask');
    expect(table.rows).toEqual([[expect.objectContaining({ text: 'false', kind: 'boolean' })]]);
    expect(table.summary).toBe('ask · 3 ms');
  });

  it('renders CONSTRUCT as four quad columns', () => {
    const quad = {
      subject: iri('urn:d3fend-graph:db-1'),
      predicate: iri('http://d3fend.mitre.org/ontologies/d3fend.owl#hardens'),
      object: iri('urn:d3fend-graph:api'),
      graph: iri('urn:d3fend-graph:query:x'),
    };
    const table = resultTable({ kind: 'construct', quads: [quad] }, { prefixes });
    expect(table.columns).toEqual(['subject', 'predicate', 'object', 'graph']);
    expect(table.rows[0].map((c) => c.text)).toEqual(['G:db-1', 'd3f:hardens', 'G:api', 'Q:x']);
  });

  it('offers a CONSTRUCT for drawing only when the whole result is small enough', () => {
    const quad = { subject: iri('urn:a'), predicate: iri('urn:p'), object: iri('urn:b'), graph: null };
    expect(resultTable({ kind: 'construct', quads: [quad] }, { prefixes }).addableQuads).toBe(1);

    const many = Array.from({ length: CONSTRUCT_GRAPH_CAP + 1 }, () => quad);
    expect(resultTable({ kind: 'construct', quads: many }, { prefixes }).addableQuads).toBe(0);

    // Truncated means we never saw the whole graph, so adding it would draw a lie.
    expect(resultTable({ kind: 'construct', quads: [quad], truncated: true }, { prefixes }).addableQuads).toBe(0);
  });

  it('survives an empty result', () => {
    const table = resultTable({ kind: 'select', vars: ['x'], rows: [] }, { prefixes });
    expect(table.rows).toEqual([]);
    expect(table.summary).toBe('0 rows');
  });
});

describe('resultTsv', () => {
  it('names SELECT columns as variables and separates every cell with a tab', () => {
    const table = resultTable(
      {
        kind: 'select',
        vars: ['artifact', 'label'],
        rows: [{ artifact: iri('urn:d3fend-graph:db-1'), label: lit('Primary database') }, { artifact: iri('urn:d3fend-graph:api') }],
      },
      { prefixes },
    );
    expect(resultTsv(table)).toBe(
      ['?artifact\t?label', 'G:db-1\t"Primary database"', 'G:api\t'].join('\n'),
    );
  });

  it('keeps an unbound cell as an empty field, so the columns still line up', () => {
    const table = resultTable({ kind: 'select', vars: ['a', 'b', 'c'], rows: [{ b: lit('x') }] }, { prefixes });
    expect(resultTsv(table).split('\n')[1]).toBe('\t"x"\t');
  });

  it('flattens tabs and newlines inside a literal, which would break the pasted grid', () => {
    const table = resultTable(
      { kind: 'select', vars: ['x'], rows: [{ x: lit('one\ttwo\nthree') }] },
      { prefixes },
    );
    expect(resultTsv(table)).toBe('?x\n"one two three"');
  });

  it('writes an ASK as a one-cell table', () => {
    expect(resultTsv(resultTable({ kind: 'ask', boolean: true }, { prefixes }))).toBe('result\ntrue');
  });

  it('writes a CONSTRUCT as its four quad columns, with no leading question marks', () => {
    const quad = {
      subject: iri('urn:d3fend-graph:db-1'),
      predicate: iri('http://d3fend.mitre.org/ontologies/d3fend.owl#accesses'),
      object: iri('urn:d3fend-graph:api'),
      graph: iri('urn:d3fend-graph:query:enrichment'),
    };
    const lines = resultTsv(resultTable({ kind: 'construct', quads: [quad] }, { prefixes })).split('\n');
    expect(lines[0]).toBe('subject\tpredicate\tobject\tgraph');
    expect(lines[1].split('\t')).toHaveLength(4);
  });

  it('copies only the rows the table kept, which is what the warning promises', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ x: lit(String(i)) }));
    const table = resultTable({ kind: 'select', vars: ['x'], rows }, { prefixes, rowCap: 5 });
    expect(resultTsv(table).split('\n')).toHaveLength(6);
  });
});

describe('parseQueryDoc', () => {
  const doc = [
    '# title: Artifacts with no defensive measure',
    '# about: Every artifact the diagram declares that nothing hardens.',
    '# needs: d3fend',
    'SELECT ?artifact WHERE { ?artifact a d3f:Artifact }',
    '# needs: not-a-declaration',
  ].join('\n');

  it('reads the leading comment block', () => {
    const parsed = parseQueryDoc(doc, 'artifacts-without-measures.rq');
    expect(parsed.title).toBe('Artifacts with no defensive measure');
    expect(parsed.about).toBe('Every artifact the diagram declares that nothing hardens.');
    expect(parsed.needs).toEqual(['d3fend']);
  });

  it('stops at the first non-comment line, so a later comment is just a comment', () => {
    expect(parseQueryDoc(doc).needs).toEqual(['d3fend']);
  });

  it('keeps the whole file as the query text, comments included', () => {
    expect(parseQueryDoc(doc).sparql).toContain('SELECT ?artifact');
    expect(parseQueryDoc(doc).sparql).toContain('# title:');
  });

  it('falls back to the file name when no title is declared', () => {
    expect(parseQueryDoc('SELECT * WHERE { ?s ?p ?o }', 'coverage-by-tactic.rq').title).toBe(
      'coverage-by-tactic',
    );
  });

  it('detects a selection-scoped query from ?this, with or without the declaration', () => {
    expect(parseQueryDoc('SELECT * WHERE { ?this ?p ?o }').needsSelection).toBe(true);
    expect(parseQueryDoc('# scope: selection\nSELECT * WHERE { ?s ?p ?o }').needsSelection).toBe(true);
    expect(parseQueryDoc('SELECT * WHERE { ?s ?p ?o }').needsSelection).toBe(false);
  });

  it('does not mistake ?thisOther for ?this', () => {
    expect(usesThis('SELECT ?thisOther WHERE { ?thisOther ?p ?o }')).toBe(false);
  });

  it('accepts multiple needs on one line', () => {
    expect(parseQueryDoc('# needs: d3fend, regulations\nSELECT * WHERE {}').needs).toEqual([
      'd3fend',
      'regulations',
    ]);
  });
});

describe('bindSelection', () => {
  it('appends a trailing VALUES clause, which is legal after every query form', () => {
    const bound = bindSelection('SELECT ?m WHERE { ?m d3f:hardens ?this }', 'urn:d3fend-graph:db-1');
    expect(bound).toBe(
      'SELECT ?m WHERE { ?m d3f:hardens ?this }\nVALUES (?this) { (<urn:d3fend-graph:db-1>) }',
    );
  });

  it('appends after LIMIT, where the grammar puts ValuesClause', () => {
    expect(bindSelection('SELECT ?m WHERE { ?m d3f:hardens ?this } LIMIT 10', 'urn:x')).toMatch(
      /LIMIT 10\nVALUES \(\?this\)/,
    );
  });

  it('leaves a query that does not mention ?this alone', () => {
    const sparql = 'SELECT ?s WHERE { ?s ?p ?o }';
    expect(bindSelection(sparql, 'urn:x')).toBe(sparql);
  });

  it('leaves the query alone when nothing is selected', () => {
    const sparql = 'SELECT ?m WHERE { ?m d3f:hardens ?this }';
    expect(bindSelection(sparql, null)).toBe(sparql);
  });
});

describe('adjustErrorPosition', () => {
  it('shifts the engine line back onto the user text by the preamble length', () => {
    const preambleLines = preambleLineCount(prefixes);
    const sent = withPreamble('SELECT ?s WHERE {\n  broken\n}', prefixes);
    // The preamble really is that long, so the offset is not a guess.
    expect(sent.split('\n').indexOf('SELECT ?s WHERE {')).toBe(preambleLines);

    const adjusted = adjustErrorPosition({ message: 'oops', line: preambleLines + 2, column: 3 }, preambleLines);
    expect(adjusted).toEqual({ message: 'oops', line: 2, column: 3 });
  });

  it('clamps into the visible text rather than reporting a line the user cannot see', () => {
    expect(adjustErrorPosition({ message: 'x', line: 2 }, 8).line).toBe(1);
  });

  it('keeps the message when the engine reports no position', () => {
    expect(adjustErrorPosition({ message: 'parse failed' }, 8)).toEqual({
      message: 'parse failed',
      line: null,
      column: null,
    });
  });

  it('survives a thrown string', () => {
    expect(adjustErrorPosition('boom', 8).message).toBe('boom');
  });
});
