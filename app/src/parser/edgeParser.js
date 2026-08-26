import { parseNodeStatement } from './nodeParser.js';
import { ANY_LINK_SOURCE, ARROW, isBackArrow, isBidirectional, isDotted } from './linkGrammar.js';
import { maskLabels } from '../editor/mermaidMasking.js';

// Matches a single arrow + |label| segment, e.g. `-->|d3f:reads|`, `--o|d3f:reads|`,
// `-.->|d3f:writes|`, `<-->|d3f:related|`. The arrow grammar itself lives in
// linkGrammar.js, which the mask and the diagnostic share.
const ARROW_LABEL_RE = new RegExp(String.raw`\s*(${ARROW})\s*\|([^|]+)\|\s*`, 'g');

/** Splits a single (already `&`-split) endpoint token into { id, shapeContent, attrs }. */
function parseEndpointToken(token) {
  // Endpoints can be bare ids (`A`), attrs-only nodes (`id@{...}`), or full
  // inline declarations (`DB[(Store d3f:Database)]`). Reuse the node parser so
  // every form resolves to the same canonical id.
  const parsed = parseNodeStatement(token);
  if (!parsed) return { id: token, shapeContent: null, attrs: null };

  const hasInlineDeclaration = token.trim() !== parsed.id || Object.keys(parsed.attrs).length > 0;
  if (!hasInlineDeclaration) return { id: parsed.id, shapeContent: null, attrs: null };
  return { id: parsed.id, shapeContent: parsed.shapeContent, attrs: parsed.attrs };
}

/**
 * Parses a mermaid edge line, possibly a chain (`A -->|p| B -->|q| C`) and
 * possibly with `&`-joined multi-node groups on either side
 * (`A & B -->|p| C`). Returns an array of { from, to, predicate, dotted,
 * arrowIndex }.
 *
 * A bidirectional arrow yields two edges, one per direction. A back arrow
 * yields none: it is a mermaid syntax error, reported by `backArrowSpans`.
 *
 * `arrowIndex` is which arrow on the line the edge came from, so a caller that
 * re-scans the raw text can tell the two halves of a chain apart — several
 * edges share an index when an `&`-group fans out, or when the arrow points
 * both ways. Nothing in the RDF path reads it (see editor/sourceLocations.js).
 */
export function parseEdgeLine(line) {
  const trimmed = line.trim();
  const arrows = [];
  const labels = [];
  let lastIndex = 0;
  const groups = [];

  ARROW_LABEL_RE.lastIndex = 0;
  let match;
  while ((match = ARROW_LABEL_RE.exec(trimmed)) !== null) {
    groups.push(trimmed.slice(lastIndex, match.index));
    arrows.push(match[1]);
    labels.push(match[2].trim());
    lastIndex = ARROW_LABEL_RE.lastIndex;
  }
  if (arrows.length === 0) return [];
  groups.push(trimmed.slice(lastIndex));

  const splitIds = (group) =>
    group
      .split('&')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseEndpointToken);

  const edges = [];
  for (let i = 0; i < arrows.length; i++) {
    const sourceIds = splitIds(groups[i]);
    const targetIds = splitIds(groups[i + 1]);
    const arrow = arrows[i];
    const predicate = labels[i];
    const dotted = isDotted(arrow);

    // A chain keeps the arrows around a broken one: `a -->|p| b o--|q| c` still
    // has the first edge to emit.
    if (isBackArrow(arrow)) continue;
    const bothWays = isBidirectional(arrow);

    const push = (from, to) => {
      const edge = { from: from.id, to: to.id, predicate, dotted, arrowIndex: i };
      if (from.shapeContent !== null) edge.fromAttrs = from;
      if (to.shapeContent !== null) edge.toAttrs = to;
      edges.push(edge);
    };

    for (const s of sourceIds) {
      for (const t of targetIds) {
        push(s, t);
        if (bothWays) push(t, s);
      }
    }
  }
  return edges;
}

/**
 * Where each arrow on a raw (untrimmed) edge line sits: `[{ from, to,
 * labelFrom, labelTo }]` in the same order as `parseEdgeLine`'s `arrowIndex`.
 * `from`/`to` span the whole `-->|d3f:reads|` run, `labelFrom`/`labelTo` just
 * the predicate inside the pipes — offsets into `line`, not into the document.
 *
 * A separate pass over the raw line rather than a by-product of `parseEdgeLine`,
 * which trims and so cannot report positions.
 */
export function arrowLabelSpans(line) {
  const spans = [];
  const re = new RegExp(ARROW_LABEL_RE.source, 'g');
  let match;
  while ((match = re.exec(line)) !== null) {
    // The arrow group starts after whatever leading whitespace `\s*` consumed.
    const from = match.index + match[0].indexOf(match[1]);
    // The label as written may be padded (`| d3f:reads |`); point at the token.
    const pad = match[2].length - match[2].trimStart().length;
    const labelFrom = match.index + match[0].indexOf('|') + 1 + pad;
    spans.push({
      from,
      to: match.index + match[0].trimEnd().length,
      labelFrom,
      labelTo: labelFrom + match[2].trim().length,
    });
  }
  return spans;
}

/**
 * Every back arrow written on one line: `[{ arrow, from, to }]`, the offsets
 * into `line`. The one place that decides a link is malformed — the parser
 * quotes it in a warning (parser/index.js), the editor paints it red
 * (editor/linkErrors.js).
 *
 * Labels are masked out first, so a `<--` inside `|...|`, `[...]` or a `%%`
 * comment is display text and not a mistake. `maskLabels` blanks with spaces,
 * which is what keeps the offsets usable against the line as written.
 */
export function backArrowSpans(line) {
  const masked = maskLabels(line);
  const spans = [];
  const re = new RegExp(ANY_LINK_SOURCE, 'g');
  let match;
  while ((match = re.exec(masked)) !== null) {
    if (!isBackArrow(match[0])) continue;
    spans.push({ arrow: match[0], from: match.index, to: match.index + match[0].length });
  }
  return spans;
}

/**
 * Two clauses because an arrow with no `|label|` is still an edge line, and has
 * to be classified as one rather than falling through to the node parser: a
 * labelled arrow of any head, or a back arrow, which carries nothing to emit
 * but must not be reported as an unrecognized statement either.
 */
export function looksLikeEdgeLine(line) {
  return (
    new RegExp(String.raw`${ARROW}\s*\|[^|]+\|`).test(line) || backArrowSpans(line).length > 0
  );
}
