/**
 * The pure half of the query pane: everything that decides *what* to show,
 * with no DOM and no engine import. `resultsView.js` renders what this returns.
 *
 * The split is the house pattern (see `edgePanelSummary` / `renderEdgePanel`) and
 * it is what makes any of this testable under vitest's node environment.
 *
 * Terms arrive as plain RDF/JS-shaped objects — `{ termType, value, language,
 * datatype }` — because the worker flattens oxigraph's terms before posting them.
 * Nothing here knows which engine produced them.
 */

import { curieWith } from '../rdf/emit.js';

/** Rows rendered into the DOM. The worker caps far higher; this caps the table. */
export const ROW_CAP = 500;

/** Quads a CONSTRUCT may add to the document as a drawn graph. */
export const CONSTRUCT_GRAPH_CAP = 2000;

const METADATA_LINE = /^#\s*(title|about|needs|scope)\s*:\s*(.*)$/i;

/**
 * Reads a canned query file's leading `# key: value` comments.
 *
 * Only the run of comment lines at the top is metadata: a `# needs:` further down
 * is a comment about the query, not a declaration, and treating it as one would
 * make a stray note change what the picker loads.
 */
export function parseQueryDoc(text, fileName = '') {
  const lines = text.split('\n');
  const meta = { title: '', about: '', needs: [], scope: 'document' };
  let i = 0;

  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (!line.startsWith('#')) break;
    const match = line.match(METADATA_LINE);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (key.toLowerCase() === 'needs') {
      meta.needs = value.split(/[,\s]+/).filter(Boolean);
    } else {
      meta[key.toLowerCase()] = value;
    }
  }

  return {
    ...meta,
    title: meta.title || fileName.replace(/\.rq$/, ''),
    // The whole file, comments included: the user should see the query they ran.
    sparql: text.trimEnd(),
    // A query mentioning ?this is only meaningful with something selected.
    needsSelection: meta.scope === 'selection' || usesThis(text),
  };
}

const THIS_VAR = /\?this\b/;

export function usesThis(sparql) {
  return THIS_VAR.test(sparql);
}

/**
 * The knowledge bases a query reaches for, read out of its `K:<id>` graph names.
 *
 * Read from the text rather than the file's `needs:` header so a hand-written
 * query gets the same treatment as a canned one: querying `K:d3fend` before it is
 * loaded returns zero rows, which reads as "no findings" and is the single most
 * misleading thing this feature could do.
 */
export function referencedSources(sparql) {
  // `K:` with an empty local name is `STR(K:)`, the namespace test — not a graph.
  return [...new Set([...sparql.matchAll(/\bK:([\w-]+)/g)].map((match) => match[1]))];
}

/**
 * Binds `?this` to an IRI by appending a trailing VALUES clause.
 *
 * SPARQL 1.1 puts an optional ValuesClause at the very end of every query form
 * (`Query ::= Prologue ( Select | Construct | Describe | Ask ) ValuesClause`), so
 * appending is grammatically safe for all of them and needs no parsing — which
 * beats substituting the IRI into the text and hoping it was not inside a string.
 */
export function bindSelection(sparql, iri) {
  if (!iri || !usesThis(sparql)) return sparql;
  return `${sparql.trimEnd()}\nVALUES (?this) { (<${iri}>) }`;
}

/**
 * Shifts an engine's line number back onto the user's text.
 *
 * The prefix preamble is prepended before the query is sent, so every reported
 * line is off by its length. Reporting an error on a line the user cannot see is
 * worse than reporting no line at all, hence the clamp to 1.
 */
export function adjustErrorPosition(error, preambleLines) {
  const line = typeof error?.line === 'number' ? Math.max(1, error.line - preambleLines) : null;
  return {
    message: error?.message ?? String(error ?? 'query failed'),
    line,
    column: typeof error?.column === 'number' ? error.column : null,
  };
}

/**
 * Formats one term for a table cell.
 *
 * `knownNodes` is the set of IRIs the graph view is currently drawing; a cell in
 * it gets `inGraph`, which is what earns the "show in graph" affordance. Any
 * other IRI is real data but not on screen, so offering to reveal it would lie.
 */
export function termCell(term, { prefixes = {}, knownNodes = null } = {}) {
  if (term == null) return { text: '', kind: 'unbound', iri: null, title: '', inGraph: false };

  if (term.termType === 'NamedNode') {
    const curie = curieWith(term.value, prefixes);
    return {
      text: curie,
      kind: 'iri',
      iri: term.value,
      // The CURIE is lossy, so the full IRI has to stay reachable.
      title: term.value,
      inGraph: !!knownNodes?.has(term.value),
    };
  }

  if (term.termType === 'BlankNode') {
    return { text: `_:${term.value}`, kind: 'bnode', iri: null, title: 'blank node', inGraph: false };
  }

  if (term.termType === 'Literal') {
    const suffix = term.language
      ? `@${term.language}`
      : term.datatype && !isPlainDatatype(term.datatype)
        ? `^^${curieWith(term.datatype, prefixes)}`
        : '';
    return {
      text: `"${term.value}"${suffix}`,
      kind: 'literal',
      iri: null,
      title: term.datatype || 'literal',
      inGraph: false,
    };
  }

  return { text: String(term.value ?? ''), kind: 'unknown', iri: null, title: '', inGraph: false };
}

const PLAIN_DATATYPES = new Set([
  'http://www.w3.org/2001/XMLSchema#string',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',
]);

function isPlainDatatype(datatype) {
  return PLAIN_DATATYPES.has(datatype);
}

/**
 * Turns an engine result into the table the pane draws.
 *
 * SELECT, ASK and CONSTRUCT/DESCRIBE all come out as the same `{columns, rows}`
 * shape so the renderer has one job: a boolean becomes a one-cell table, and
 * quads become four columns. The alternative was three renderers.
 */
export function resultTable(result, { rowCap = ROW_CAP, prefixes = {}, knownNodes = null } = {}) {
  const opts = { prefixes, knownNodes };

  if (result?.kind === 'ask') {
    return {
      kind: 'ask',
      columns: ['result'],
      rows: [[{ text: result.boolean ? 'true' : 'false', kind: 'boolean', iri: null, title: '', inGraph: false }]],
      rowCount: 1,
      shown: 1,
      truncated: false,
      capped: false,
      summary: summarize(result, 1, 1, false),
    };
  }

  if (result?.kind === 'construct') {
    const quads = result.quads ?? [];
    const shown = quads.slice(0, rowCap);
    return {
      kind: 'construct',
      columns: ['subject', 'predicate', 'object', 'graph'],
      rows: shown.map((q) => [
        termCell(q.subject, opts),
        termCell(q.predicate, opts),
        termCell(q.object, opts),
        termCell(q.graph, opts),
      ]),
      rowCount: quads.length,
      shown: shown.length,
      truncated: !!result.truncated,
      capped: quads.length > shown.length,
      // Only the whole result is worth adding: a capped graph would draw a lie.
      addableQuads: !result.truncated && quads.length <= CONSTRUCT_GRAPH_CAP ? quads.length : 0,
      summary: summarize(result, quads.length, shown.length, quads.length > shown.length),
    };
  }

  const vars = result?.vars ?? [];
  const rows = result?.rows ?? [];
  const shown = rows.slice(0, rowCap);
  return {
    kind: 'select',
    columns: vars,
    rows: shown.map((row) => vars.map((name) => termCell(row[name], opts))),
    rowCount: rows.length,
    shown: shown.length,
    truncated: !!result.truncated,
    capped: rows.length > shown.length,
    summary: summarize(result, rows.length, shown.length, rows.length > shown.length),
  };
}

/**
 * The status line. Built here rather than in the renderer so the caps are
 * asserted in tests: silently showing 500 of 40000 rows as if that were the
 * answer is the failure mode this text exists to prevent.
 */
function summarize(result, rowCount, shown, capped) {
  const parts = [];
  if (result?.kind === 'ask') parts.push('ask');
  else parts.push(`${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`);
  if (capped) parts.push(`showing first ${shown}`);
  if (result?.truncated) parts.push('engine limit reached — result incomplete');
  if (typeof result?.ms === 'number') parts.push(`${Math.round(result.ms)} ms`);
  return parts.join(' · ');
}
