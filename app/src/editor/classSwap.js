import { CLASS_TOKEN_RE } from '../parser/nodeParser.js';
import { collectSourceLocations, sourceLocationsFor } from './sourceLocations.js';

/**
 * Changing what class a node is drawn as — the node panel's "change class"
 * dropdown (viz/nodePanel.js) writing into the mermaid source.
 *
 * Unlike `insertMeasure.js`'s `relationInsertion`, which adds new lines,
 * this replaces one existing token in place: the node keeps its id, shape
 * and every other word of its label, only the class qname changes. The
 * anchor is found the same way — by scanning the live text at call time
 * (docs/adr/0017-go-to-mermaid-source.md) — so the position can never be
 * stale.
 */

/** Offset of the start of each 1-based line. */
function lineStarts(text) {
  const starts = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

/**
 * The change that retypes the node written as `anchorId` from `oldQname` to
 * `newQname`: `{ from, to, insert }` as CodeMirror wants it, or `null` when
 * either qname is missing, they are equal, the anchor is not written in any
 * mermaid block of `text`, or `oldQname` is not actually a token on its
 * declaration line.
 *
 * A node can carry more than one class token on its declaration line (a
 * node typed in two vocabularies); the first occurrence of `oldQname`
 * exactly is the one replaced, leaving every other token untouched.
 */
export function classTokenReplacement(text, anchorId, oldQname, newQname) {
  if (!anchorId || !oldQname || !newQname || oldQname === newQname) return null;

  const index = collectSourceLocations(text);
  const [location] = sourceLocationsFor(index, anchorId);
  if (!location) return null;

  const lines = text.split('\n');
  const raw = lines[location.line - 1] ?? '';

  CLASS_TOKEN_RE.lastIndex = 0;
  let match;
  let found = null;
  while ((match = CLASS_TOKEN_RE.exec(raw)) !== null) {
    if (match[0] === oldQname) {
      found = match;
      break;
    }
  }
  if (!found) return null;

  const lineStart = lineStarts(text)[location.line - 1];
  return {
    from: lineStart + found.index,
    to: lineStart + found.index + found[0].length,
    insert: newQname,
  };
}
