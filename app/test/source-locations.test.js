import { describe, it, expect } from 'vitest';
import {
  collectSourceLocations,
  edgeKey,
  edgeLocationsFor,
  pickSourceLocation,
  sourceLocationsFor,
} from '../src/editor/sourceLocations.js';

// Line numbers are in the comments and asserted directly, so a change here that
// shifts a line is caught rather than silently re-baselined.
const DOC = [
  '# Doc', // 1
  '', // 2
  'Prose mentioning n1 and Server outside any block.', // 3
  '', // 4
  '```mermaid', // 5
  '---', // 6
  'id: one', // 7
  'title: Layer one', // 8
  '---', // 9
  'graph TD', // 10
  '', // 11
  'n1[d3f:Network]', // 12
  'Server[Host d3f:Server]', // 13
  'port-->|d3f:used-by| p2', // 14
  'n1 <-->|d3f:communicates-with| Server', // 15
  'classDef hot fill:#f00', // 16
  'class n1 hot', // 17
  '%% n1 is commented here', // 18
  'Server[Host]:::hot', // 19
  '```', // 20
  '', // 21
  '```js', // 22
  'const n1 = 1;', // 23
  '```', // 24
  '', // 25
  '```mermaid', // 26
  '---', // 27
  'id: two', // 28
  '---', // 29
  'graph', // 30
  'subgraph n1[d3f:Network]', // 31
  '    direction TB', // 32
  '    h1[d3f:Host]', // 33
  'end', // 34
  'A -->|d3f:reads| B -->|d3f:writes| C', // 35
  'X & Y -->|d3f:reads| Z', // 36
  '```', // 37
].join('\n');

const INDEX = collectSourceLocations(DOC);

/** Every location must slice back to the text it claims to point at. */
const sliced = (location) => DOC.slice(location.from, location.to);
const summary = (locations) => locations.map((l) => [l.line, l.kind, sliced(l)]);

describe('collectSourceLocations — nodes', () => {
  it('reports offsets that slice back to the id, on 1-based lines', () => {
    expect(summary(INDEX.nodes.get('h1'))).toEqual([[33, 'declaration', 'h1']]);
  });

  it('finds a shape declaration, an edge mention and a subgraph opening', () => {
    expect(summary(INDEX.nodes.get('n1'))).toEqual([
      [12, 'declaration', 'n1'],
      [15, 'mention', 'n1'],
      [31, 'subgraph', 'n1'],
    ]);
  });

  it('ignores ids in prose, in a non-mermaid block and in frontmatter', () => {
    // Line 3 and line 23 both say `n1`, and the frontmatter says `one`/`two`.
    expect(INDEX.nodes.get('n1').every((l) => l.line !== 3 && l.line !== 23)).toBe(true);
    expect(INDEX.nodes.has('one')).toBe(false);
    expect(INDEX.nodes.has('two')).toBe(false);
    expect(INDEX.nodes.has('Layer')).toBe(false);
  });

  it('does not mistake label text for a reference to a node of that name', () => {
    // `Server` is declared on 13 and 19 and mentioned on 15, but the word also
    // sits inside `Server[Host d3f:Server]`'s label — which must not count.
    expect(summary(INDEX.nodes.get('Server'))).toEqual([
      [13, 'declaration', 'Server'],
      [15, 'mention', 'Server'],
      [19, 'declaration', 'Server'],
    ]);
  });

  it('finds both endpoints of an edge written without spaces', () => {
    // The ID_RE regression: `port-->` tokenizes as `port--` unmasked.
    expect(summary(INDEX.nodes.get('port'))).toEqual([[14, 'mention', 'port']]);
    expect(summary(INDEX.nodes.get('p2'))).toEqual([[14, 'mention', 'p2']]);
  });

  it('skips styling statements, the direction header, `end` and `:::` names', () => {
    expect(INDEX.nodes.has('hot')).toBe(false);
    expect(INDEX.nodes.has('classDef')).toBe(false);
    expect(INDEX.nodes.has('direction')).toBe(false);
    expect(INDEX.nodes.has('TB')).toBe(false);
    expect(INDEX.nodes.has('end')).toBe(false);
    expect(INDEX.nodes.has('subgraph')).toBe(false);
    expect(INDEX.nodes.has('graph')).toBe(false);
  });

  it('records which block each location came from', () => {
    expect(INDEX.nodes.get('n1').map((l) => l.block)).toEqual([0, 0, 1]);
  });

  it('returns empty maps for a document with no mermaid block', () => {
    const empty = collectSourceLocations('# Just prose\n\nabout n1.\n');
    expect(empty.nodes.size).toBe(0);
    expect(empty.edges.size).toBe(0);
  });

  it('still resolves inside an unterminated block', () => {
    const typing = ['```mermaid', 'graph TD', 'a1[d3f:Host]', 'b1[d3f:Host]'].join('\n');
    expect(collectSourceLocations(typing).nodes.has('a1')).toBe(true);
  });
});

describe('collectSourceLocations — edges', () => {
  it('points at the predicate token, not the line start', () => {
    expect(summary(INDEX.edges.get(edgeKey('port', 'd3f:used-by', 'p2')))).toEqual([
      [14, 'edge', 'd3f:used-by'],
    ]);
  });

  it('resolves both directions of a two-headed arrow to the same span', () => {
    // Written `n1 <-->|p| Server`: a head at each end asserts the relation both
    // ways, and either triple jumps to the one predicate token written.
    const forward = summary(INDEX.edges.get(edgeKey('n1', 'd3f:communicates-with', 'Server')));
    expect(forward).toEqual([[15, 'edge', 'd3f:communicates-with']]);
    expect(summary(INDEX.edges.get(edgeKey('Server', 'd3f:communicates-with', 'n1')))).toEqual(forward);
  });

  it('gives each half of a chain its own span', () => {
    const first = INDEX.edges.get(edgeKey('A', 'd3f:reads', 'B'));
    const second = INDEX.edges.get(edgeKey('B', 'd3f:writes', 'C'));
    expect(summary(first)).toEqual([[35, 'edge', 'd3f:reads']]);
    expect(summary(second)).toEqual([[35, 'edge', 'd3f:writes']]);
    expect(first[0].to).toBeLessThan(second[0].from);
  });

  it('fans an &-group out onto the shared arrow', () => {
    const xz = INDEX.edges.get(edgeKey('X', 'd3f:reads', 'Z'));
    const yz = INDEX.edges.get(edgeKey('Y', 'd3f:reads', 'Z'));
    expect(summary(xz)).toEqual([[36, 'edge', 'd3f:reads']]);
    expect(yz[0]).toEqual(xz[0]);
  });
});

describe('sourceLocationsFor', () => {
  it('orders declarations ahead of an earlier mention', () => {
    // Server is mentioned on 15, between its two declarations on 13 and 19.
    expect(sourceLocationsFor(INDEX, 'Server').map((l) => l.line)).toEqual([13, 19, 15]);
  });

  it('keeps document order inside each group', () => {
    expect(sourceLocationsFor(INDEX, 'n1').map((l) => l.line)).toEqual([12, 31, 15]);
  });

  it('is empty for an id that is not written anywhere', () => {
    expect(sourceLocationsFor(INDEX, 'nope')).toEqual([]);
  });
});

describe('edgeLocationsFor', () => {
  it('concatenates several keys in document order', () => {
    const keys = [
      edgeKey('B', 'd3f:writes', 'C'),
      edgeKey('port', 'd3f:used-by', 'p2'),
      edgeKey('A', 'd3f:reads', 'B'),
    ];
    expect(edgeLocationsFor(INDEX, keys).map((l) => sliced(l))).toEqual([
      'd3f:used-by',
      'd3f:reads',
      'd3f:writes',
    ]);
  });

  it('skips keys that match nothing written', () => {
    expect(edgeLocationsFor(INDEX, [edgeKey('A', 'd3f:reads', 'Z')])).toEqual([]);
  });
});

describe('pickSourceLocation', () => {
  const locations = sourceLocationsFor(INDEX, 'Server');

  it('starts at the first location', () => {
    expect(pickSourceLocation(locations).line).toBe(13);
  });

  it('advances when the caret is already on one', () => {
    expect(pickSourceLocation(locations, locations[0].from).line).toBe(19);
  });

  it('wraps around from the last', () => {
    expect(pickSourceLocation(locations, locations[2].from).line).toBe(13);
  });

  it('is null for nothing to jump to', () => {
    expect(pickSourceLocation([])).toBe(null);
  });
});
