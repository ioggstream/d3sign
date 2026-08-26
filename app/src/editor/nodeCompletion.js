import { ID_RE } from '../parser/nodeParser.js';
import { getSymbols } from './documentSymbols.js';

// Same character set the parser accepts for a node id, minus the `+` so the
// prefix may still be empty (Ctrl+Space on a blank position lists everything).
const ID_CHARS = ID_RE.replace(/\+$/, '');
const ID_PREFIX = new RegExp(`${ID_CHARS}*$`);

export const NODE_PREFIX = ID_PREFIX;
export const DOCUMENT_SECTION = { name: 'Document nodes', rank: 1 };

function optionFor(entry) {
  const types = entry.classes.length ? entry.classes.join(' ') : 'untagged';
  return {
    label: entry.id,
    type: 'variable',
    // The row's right-hand column: the node's original rdf:type(s), so picking
    // a known id from an earlier diagram doesn't mean remembering how it was
    // typed there.
    detail: types,
    // Document nodes are the closer match while authoring, so they sort above
    // the 4664 ontology terms.
    boost: 1,
    section: DOCUMENT_SECTION,
    // `infoText` rather than CodeMirror's `info` — see d3fendCompletion.js for why
    // handing the popup a function that returns a string is not survivable.
    infoText: () => {
      const lines = [];
      if (entry.label) lines.push(entry.label);
      lines.push(`rdf:type: ${types}`);
      if (entry.diagrams.length) lines.push(`Defined in: ${entry.diagrams.join(', ')}`);
      return lines.join('\n\n');
    },
  };
}

/**
 * CodeMirror `CompletionSource` offering every node id declared anywhere in the
 * document — including ids that carry no d3f: class, which is the point: a node
 * introduced in an earlier diagram should be re-usable by name.
 *
 * Declines `d3f:`-prefixed positions, which belong to `d3fendCompletionSource`.
 */
export function nodeCompletionSource(context) {
  const match = context.matchBefore(ID_PREFIX);
  const from = match ? match.from : context.pos;
  if (!match && !context.explicit) return null;

  // `d3f:Foo` matches ID_PREFIX at `Foo`; the colon before it means the user is
  // naming an ontology term, not a node.
  if (context.state.doc.sliceString(Math.max(0, from - 1), from) === ':') return null;

  const symbols = getSymbols(context.state);
  if (!symbols.size) return null;

  return {
    from,
    options: [...symbols.values()].map(optionFor),
    validFor: ID_PREFIX,
  };
}
