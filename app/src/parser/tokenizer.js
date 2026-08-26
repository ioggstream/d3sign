import { looksLikeEdgeLine } from './edgeParser.js';
import { parseSubgraphOpen, isSubgraphEnd } from './subgraphParser.js';

/** Purely presentational mermaid styling: `classDef x ...` / `class a,b x`. */
const STYLE_STATEMENT_RE = /^(classDef|class)\b/;
/** The `:::styleClass` suffix mermaid allows on a node or edge endpoint. */
const STYLE_SUFFIX_RE = /:::[A-Za-z0-9_-]+/g;

/**
 * Classifies one raw mermaid line into `{ type, line }`, or null when the line
 * carries no diagram content: blank, a `graph`/`flowchart` direction header, or
 * a `classDef`/`class` styling statement. `line` is the statement with its `%%`
 * comment and `:::styleClass` suffix removed, ready for the node/edge parsers.
 *
 * Split out of `tokenizeBody` so the editor can ask "what is on this line?"
 * without reimplementing the answer — see editor/sourceLocations.js, which needs
 * the same classification but keeps the raw line to compute offsets from.
 */
export function tokenizeLine(rawLine) {
  const withoutComment = rawLine.replace(/%%.*$/, '');
  const line = withoutComment.replace(STYLE_SUFFIX_RE, '').trim();
  if (!line) return null;
  if (/^(graph|flowchart)\b/.test(line)) return null;
  if (STYLE_STATEMENT_RE.test(line)) return null;

  if (parseSubgraphOpen(line)) return { type: 'subgraph-open', line };
  if (isSubgraphEnd(line)) return { type: 'subgraph-end', line };
  if (looksLikeEdgeLine(line)) return { type: 'edge', line };
  return { type: 'node', line };
}

/**
 * Splits the mermaid body into classified logical lines. Handles the
 * `graph`/`flowchart` direction header and strips `%%` comments.
 * A "logical line" may itself still need node/edge parsing.
 *
 * Mermaid styling carries no d3fend meaning, so `classDef`/`class` statements
 * are dropped and the `:::styleClass` suffix is stripped from the lines that
 * keep their node declarations.
 */
export function tokenizeBody(body) {
  const lines = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const token = tokenizeLine(rawLine);
    if (token) lines.push(token);
  }
  return lines;
}
