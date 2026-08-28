import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDiagram } from '../src/parser/index.js';
import { extractMermaidBlocks, titleHash, parseDocument } from '../src/parser/document.js';

const diagramsDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/examples');

function readFixture(name) {
  return readFileSync(path.join(diagramsDir, name), 'utf-8');
}

// The mermaid syntax the parser supports is covered case by case in
// data/examples/testcases.md, snapshotted as turtle by rdf-emit.test.js. What
// is left here is what a turtle snapshot cannot express: arrow style, warnings
// and the document level above a single diagram.

describe('parseDiagram — dotted arrows', () => {
  // `dotted` is presentational: it survives in the AST for the renderer and is
  // deliberately dropped on the way to RDF, so no snapshot can assert it.
  const ast = parseDiagram(
    ['graph', 'a[A d3f:Host]', 'b[B d3f:Host]', 'a -.->|d3f:related| b', 'a -->|d3f:reads| b'].join('\n'),
  );

  it('marks an edge dotted when the arrow is -.->', () => {
    expect(ast.edges.find((e) => e.predicate === 'd3f:related').dotted).toBe(true);
  });

  it('leaves a plain --> arrow undotted', () => {
    expect(ast.edges.find((e) => e.predicate === 'd3f:reads').dotted).toBe(false);
  });
});

describe('parseDiagram — arrow heads', () => {
  // Which triples each head yields is snapshotted (`edge-forms` in testcases.md).
  // What is left here is the ambiguity the o/x heads create with ids, which no
  // snapshot would make obvious.
  const edgesOf = (line) =>
    parseDiagram(['graph', 'repo[Repo d3f:Host]', 'linux[Linux d3f:Host]', line].join('\n')).edges.map((e) => [
      e.from,
      e.to,
    ]);

  it('keeps an id that ends in o or x out of the arrow', () => {
    // `o` and `x` are legal id characters: the head is only a head where an id
    // cannot end, so `repo-->` is `repo` and `-->`, not `rep` and `o-->`.
    expect(edgesOf('repo-->|d3f:reads| linux')).toEqual([['repo', 'linux']]);
    expect(edgesOf('repo--o|d3f:reads| linux')).toEqual([['repo', 'linux']]);
  });

  it('reads both directions off an arrow with a head at each end', () => {
    expect(edgesOf('repo o--o|d3f:related| linux')).toEqual([
      ['repo', 'linux'],
      ['linux', 'repo'],
    ]);
    expect(edgesOf('repo <-->|d3f:related| linux')).toEqual([
      ['repo', 'linux'],
      ['linux', 'repo'],
    ]);
  });

  it('marks a dotted circle-head arrow dotted', () => {
    const ast = parseDiagram(['graph', 'a[A d3f:Host]', 'b[B d3f:Host]', 'a -.-o|d3f:related| b'].join('\n'));
    expect(ast.edges.map((e) => [e.from, e.to, e.dotted])).toEqual([['a', 'b', true]]);
  });

  it('normalizes inline endpoint node declarations to canonical ids', () => {
    const ast = parseDiagram(
      ['graph', 'S[Server d3f:Server]', 'S -->|d3f:reads| DB[(Store d3f:Database)]', 'S -->|d3f:writes| LOG[Audit log]'].join(
        '\n',
      ),
    );

    expect(ast.edges.map((e) => [e.from, e.to])).toEqual([
      ['S', 'DB'],
      ['S', 'LOG'],
    ]);
    expect(ast.nodes.find((n) => n.id === 'DB')).toMatchObject({ label: 'Store', classes: ['d3f:Database'] });
    expect(ast.nodes.find((n) => n.id === 'LOG')).toMatchObject({ label: 'Audit log', classes: [] });
  });
});

describe('parseDiagram — the marker the info panel writes', () => {
  it('reads an added relation as two nodes and one edge, and the comment as nothing', () => {
    const ast = parseDiagram(
      [
        'graph TD',
        'u[Alice d3f:User]',
        '%% Added via UI',
        'useraccount[d3f:UserAccount]',
        'u -->|d3f:has-account| useraccount',
      ].join('\n'),
    );
    expect(ast.nodes.map((n) => n.id)).toEqual(['u', 'useraccount']);
    expect(ast.edges.map((e) => [e.from, e.predicate, e.to])).toEqual([
      ['u', 'd3f:has-account', 'useraccount'],
    ]);
    expect(ast.warnings).toEqual([]);
  });
});

describe('parseDiagram — ATT&CK sub-technique classes', () => {
  // The info panel can now add an attack row, and an ATT&CK sub-technique class
  // carries a dot: reading `d3f:T1548.001` as `d3f:T1548` would type the node as
  // the parent technique and leave `.001` as its label.
  const nodeOf = (label) => parseDiagram(['graph', `t[${label}]`].join('\n')).nodes[0];

  it('keeps the dotted local name in one class token', () => {
    expect(nodeOf('d3f:T1548.001')).toMatchObject({ classes: ['d3f:T1548.001'], label: '' });
    // ATLAS tactics are dotted too, and their second segment is not all digits.
    expect(nodeOf('d3f:AML.TA0000')).toMatchObject({ classes: ['d3f:AML.TA0000'], label: '' });
  });

  it('leaves prose punctuation out of the token', () => {
    // A dotted segment counts only when it holds a digit — every dotted D3FEND
    // local name does, and no English word does.
    expect(nodeOf('Bypasses UAC d3f:T1548.')).toMatchObject({ classes: ['d3f:T1548'], label: 'Bypasses UAC .' });
    expect(nodeOf('d3f:User.Then the rest')).toMatchObject({ classes: ['d3f:User'], label: '.Then the rest' });
  });
});

describe('parseDiagram — back arrows', () => {
  // Mermaid has no back arrow: `<--`, `o--` and `x--` only open a link that a
  // head on the right has to close, so the line does not render at all. No
  // snapshot can show a warning, and there is no triple to snapshot either.
  const parse = (line) =>
    parseDiagram(['graph', 'a[A d3f:Host]', 'b[B d3f:Host]', line].join('\n'));
  const backArrowWarnings = (ast) => ast.warnings.filter((w) => w.includes('back arrow'));

  it.each(['a <--|d3f:reads| b', 'a o--|d3f:reads| b', 'a x--|d3f:reads| b', 'a <-.-|d3f:reads| b', 'a <-- b'])(
    'emits no edge and one warning for `%s`',
    (line) => {
      const ast = parse(line);
      expect(ast.edges).toEqual([]);
      expect(backArrowWarnings(ast).length).toBe(1);
    },
  );

  it('keeps the other arrows of a chain around a broken one', () => {
    const ast = parse('a -->|d3f:reads| b o--|d3f:writes| a');
    expect(ast.edges.map((e) => [e.from, e.to])).toEqual([['a', 'b']]);
    expect(backArrowWarnings(ast).length).toBe(1);
  });

  it('says nothing about an arrow drawn inside display text', () => {
    const ast = parse('a -->|d3f:reads, not <-- reads| b');
    expect(backArrowWarnings(ast)).toEqual([]);
  });
});

describe('parseDiagram — warnings', () => {
  it('says nothing about a diagram that tags its nodes', () => {
    const ast = parseDiagram('graph\na[Host d3f:Host]');
    expect(ast.warnings).toEqual([]);
  });

  it('flags a diagram whose d3f: tokens are only on the edges', () => {
    // The convention mta.md predates: d3f: edge labels, but no d3f: node classes.
    const ast = parseDiagram(['graph', 'a[Host]', 'a -->|d3f:reads| b'].join('\n'));
    expect(ast.warnings.some((w) => w.includes('unsupported syntax'))).toBe(true);
  });

  it('drops an edge label with no vocabulary prefix, and says so', () => {
    // `|accesses|` used to become `d3f:accesses`. Convenient for a real property,
    // wrong for everything else: the same rule made mta.md's `|a|` and `|subClassOf|`
    // into predicates that exist in no vocabulary.
    const ast = parseDiagram(['graph', 'a[Host d3f:Host]', 'a -->|accesses| b'].join('\n'));
    expect(ast.edges).toEqual([]);
    expect(ast.warnings.some((w) => w.includes('Ignored edge label "accesses"'))).toBe(true);
    // The endpoints are still mentioned, so they are still declared.
    expect(ast.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('keeps an edge label in any writable vocabulary', () => {
    const ast = parseDiagram(
      ['graph', 'a[Host d3f:Host]', 'a -->|d3f:reads| b', 'a -->|dpv:hasDataSubject| c'].join('\n'),
    );
    expect(ast.edges.map((e) => e.predicate)).toEqual(['d3f:reads', 'dpv:hasDataSubject']);
  });

  it('drops an edge label in a vocabulary a diagram may not write', () => {
    const ast = parseDiagram(['graph', 'a[Host d3f:Host]', 'a -->|risk:causedBy| b'].join('\n'));
    expect(ast.edges).toEqual([]);
    expect(ast.warnings.some((w) => w.includes('Ignored edge label "risk:causedBy"'))).toBe(true);
  });

  it('does not flag classDef/class statements as unrecognized', () => {
    const ast = parseDiagram(
      ['graph', 'classDef whatever fill:none', 'a[Host d3f:Host]:::whatever', 'class a whatever'].join('\n'),
    );
    expect(ast.warnings).toEqual([]);
    expect(ast.nodes.map((n) => [n.id, n.classes, n.label])).toEqual([['a', ['d3f:Host'], 'Host']]);
  });
});

describe('parseDocument — multiple mermaid diagrams per file', () => {
  const DOC = [
    '```mermaid\n---\nid: one\ntitle: First\n---\ngraph\na[Host d3f:Host]\n```\n',
    '```mermaid\n---\nid: two\ntitle: Second\n---\ngraph\nb[Host d3f:Host]\n```\n',
  ].join('\n');

  it('extracts every ```mermaid fence in document order', () => {
    const blocks = extractMermaidBlocks(DOC);
    expect(blocks.length).toBe(2);
    expect(blocks[0].source).toContain('id: one');
    expect(blocks[1].source).toContain('id: two');
  });

  it('parses each diagram and captures its title and diagramId', () => {
    const { diagrams, warnings } = parseDocument(DOC);
    expect(diagrams.map((d) => [d.diagramId, d.title])).toEqual([
      ['one', 'First'],
      ['two', 'Second'],
    ]);
    expect(warnings).toEqual([]);
  });

  it('warns when a diagram is missing a required title', () => {
    const doc = '```mermaid\n---\nid: no-title\n---\ngraph\na[d3f:User a]\n```\n';
    const { diagrams, warnings } = parseDocument(doc);
    expect(diagrams[0].title).toBe('');
    expect(warnings.some((w) => w.includes('missing a required title'))).toBe(true);
  });

  it('warns on duplicate titles across diagrams', () => {
    const doc = [
      '```mermaid\n---\nid: a\ntitle: Same\n---\ngraph\nx[d3f:User a]\n```\n',
      '```mermaid\n---\nid: b\ntitle: Same\n---\ngraph\ny[d3f:User a]\n```\n',
    ].join('\n');
    const { warnings } = parseDocument(doc);
    expect(warnings.some((w) => w.includes('Duplicate diagram title: "Same"'))).toBe(true);
  });
});

describe('titleHash', () => {
  it('is deterministic for the same title', () => {
    expect(titleHash('High-level architecture')).toBe(titleHash('High-level architecture'));
  });

  it('differs for different titles', () => {
    expect(titleHash('High-level architecture')).not.toBe(titleHash('Data Center 1 Infrastructure'));
  });
});

describe('the shipped example diagrams still parse', () => {
  // Deliberately says nothing about their content: the examples are documentation
  // and get remodelled, so pinning an id or a predicate here only breaks the build.
  const examples = readdirSync(diagramsDir).filter((f) => f.endsWith('.md'));

  it.each(examples)('%s yields at least one diagram with nodes', (name) => {
    const { diagrams } = parseDocument(readFixture(name));
    expect(diagrams.length).toBeGreaterThan(0);
    expect(diagrams.some((d) => d.ast.nodes.length > 0)).toBe(true);
  });

  // A title is required (parseDocument warns without one) and names the diagram in
  // the diagram list and the symbol tooltips, so the shipped examples must carry one.
  it.each(examples)('%s titles every diagram, without repeating a title', (name) => {
    const { warnings } = parseDocument(readFixture(name));
    expect(warnings.filter((w) => w.includes('missing a required title'))).toEqual([]);
    expect(warnings.filter((w) => w.includes('Duplicate diagram title'))).toEqual([]);
  });
});
