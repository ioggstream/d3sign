/**
 * Offset-preserving masks over a single raw mermaid line.
 *
 * Every function here replaces the characters it removes with spaces rather
 * than deleting them, so a column found in the masked line is the same column
 * in the original. That is what lets the editor point at an id token — for
 * colouring it (knownNodes.js) or for jumping to it (sourceLocations.js) —
 * without reimplementing the parser. `maskLabels` is used from the parser side
 * too, by the back-arrow diagnostic in parser/edgeParser.js.
 *
 * Apply them in the order `maskLabels` → `maskStyleSuffix` → `maskLinkOperators`
 * (see `maskMermaidLine`): the label mask has to run first so that a `|`, a
 * bracket or a `-->` sitting inside display text is already gone.
 */

import { ANY_LINK_SOURCE } from '../parser/linkGrammar.js';

/**
 * Blanks out everything that is display text rather than an identifier: label
 * content in `[...]`, `(...)`, `{...}`, edge labels in `|...|`, quoted strings,
 * and `%%` comments.
 *
 * Without this, a node id that also appears as a word in someone's label —
 * `S[Server]` next to a node called `Server` — would be painted as a reference.
 */
export function maskLabels(line) {
  const out = [];
  let depth = 0;
  let inPipe = false;
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (!inQuote && !inPipe && depth === 0 && ch === '%' && line[i + 1] === '%') {
      // Comment runs to end of line.
      for (let j = i; j < line.length; j++) out.push(' ');
      break;
    }

    if (ch === '"') {
      inQuote = !inQuote;
      out.push(' ');
      continue;
    }
    if (inQuote) {
      out.push(' ');
      continue;
    }
    if (ch === '|') {
      inPipe = !inPipe;
      out.push(' ');
      continue;
    }
    if (inPipe) {
      out.push(' ');
      continue;
    }
    if (ch === '[' || ch === '(' || ch === '{') {
      depth++;
      out.push(' ');
      continue;
    }
    if (ch === ']' || ch === ')' || ch === '}') {
      if (depth > 0) depth--;
      out.push(' ');
      continue;
    }
    out.push(depth > 0 ? ' ' : ch);
  }

  return out.join('');
}

/** The `:::styleClass` suffix, which tokenizer.js strips before parsing. */
const STYLE_SUFFIX_RE = /:::[A-Za-z0-9_-]+/g;

/**
 * Blanks `:::styleClass`. The style name is not an id, but it is spelled like
 * one, so leaving it in makes `A[Host]:::net` look like a reference to a node
 * called `net`.
 */
export function maskStyleSuffix(line) {
  return line.replace(STYLE_SUFFIX_RE, (match) => ' '.repeat(match.length));
}

// Link operators, from the one grammar that describes them: the mask has to
// blank exactly what the parser reads as an arrow, `c o--|p| d` included — an
// unmasked `o` there would look like an id of its own.
const LINK_OPERATOR_RE = new RegExp(ANY_LINK_SOURCE, 'g');

/**
 * Blanks the arrows joining endpoints.
 *
 * Without it `port-->|d3f:used-by| p2` tokenizes as `port--` and `p2`, because
 * `-` is an id character: the id `port` is never seen at all. Arrows written
 * with spaces around them hide the bug, which is why it survived so long.
 */
export function maskLinkOperators(line) {
  return line.replace(LINK_OPERATOR_RE, (match) => ' '.repeat(match.length));
}

/** All three masks, in the order they have to run. */
export function maskMermaidLine(line) {
  return maskLinkOperators(maskStyleSuffix(maskLabels(line)));
}
