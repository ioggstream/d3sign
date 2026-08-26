import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toTurtle } from '../src/rdf/serialize.js';
import { parseTrigText, MANUAL_GRAPH } from '../src/rdf/parseTrig.js';

const snapshotsDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'snapshots');
const snapshots = readdirSync(snapshotsDir).filter((f) => f.endsWith('.trig'));

/** Comparable key for a quad, so round-tripped sets can be compared as sets. */
function quadKey(q) {
  return [q.graph.value, q.subject.value, q.predicate.value, q.object.value].join(' ');
}

describe('parseTrigText — round-trips what serialize.js writes', () => {
  it.each(snapshots)('%s', async (file) => {
    const text = readFileSync(path.join(snapshotsDir, file), 'utf-8');
    const { graphs, error } = parseTrigText(text);
    expect(error).toBeNull();

    const quads = [...graphs.values()].flat();
    // The named graph survives the round trip: the pane's text is the only place
    // graph membership is recorded once it has been hand-edited.
    expect([...graphs.keys()].every((name) => name !== MANUAL_GRAPH)).toBe(true);

    const reserialized = await toTurtle(quads);
    const { graphs: again } = parseTrigText(reserialized);
    expect([...again.keys()].sort()).toEqual([...graphs.keys()].sort());
    expect([...again.values()].flat().map(quadKey).sort()).toEqual(quads.map(quadKey).sort());
  });
});

describe('parseTrigText — editor states', () => {
  it('reports a parse error instead of throwing on half-typed text', () => {
    const { graphs, error } = parseTrigText('G:a { <urn:x> <urn:y>');
    expect(error).toBeTruthy();
    expect(graphs.size).toBe(0);
  });

  it('puts triples written outside any graph block in the manual graph', () => {
    const { graphs, error } = parseTrigText('<urn:d3fend-graph:a> <urn:d3fend-graph:p> <urn:d3fend-graph:b>.');
    expect(error).toBeNull();
    expect([...graphs.keys()]).toEqual([MANUAL_GRAPH]);
    expect(graphs.get(MANUAL_GRAPH)[0].graph.value).toBe(MANUAL_GRAPH);
  });

  it('groups quads by their named graph', () => {
    const text = `
      @prefix G: <urn:d3fend-graph:>.
      G:one { G:a G:p G:b }
      G:two { G:c G:p G:d. G:e G:p G:f }
    `;
    const { graphs } = parseTrigText(text);
    expect([...graphs.keys()].sort()).toEqual(['urn:d3fend-graph:one', 'urn:d3fend-graph:two']);
    expect(graphs.get('urn:d3fend-graph:two')).toHaveLength(2);
  });
});
