import { hoverTooltip, keymap } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { renderD3fendCard } from './d3fendCard.js';
import { getItem } from './d3fendHierarchy.js';
import { termTokenPattern } from './vocabularies.js';

// Escape dismisses the tooltip. `hoverTooltip` otherwise only hides on pointer
// move, and the tooltip is drawn above the token — right over the lines you are
// reading — so a keyboard user has no way out of it.
const dismissHover = StateEffect.define();

// One pattern per build, covering every vocabulary the editor has terms for — d3f:
// plus the legal ones (vocabularies.js), so a hoverable prefix and a completable one
// are the same set by construction.
const TERM_TOKEN = termTokenPattern();

// Find the <prefix>:<name> token covering `pos` on the given line text, relative
// to the line's own start offset (`lineFrom`). `name` is the qname, i.e. the whole
// token, because that is what identifies a term once there is more than one
// vocabulary.
export function matchTermToken(lineText, posInLine) {
  TERM_TOKEN.lastIndex = 0;
  let m;
  while ((m = TERM_TOKEN.exec(lineText)) !== null) {
    if (posInLine >= m.index && posInLine <= m.index + m[0].length) {
      return { name: m[0], start: m.index, end: m.index + m[0].length };
    }
  }
  return undefined;
}

// Term hover: shown for any known vocabulary's token anywhere in the text, not
// just while actively typing a completion. It is the only surface for term
// information — one card, carrying everything: definition, ancestor path,
// inverse, parents and children, the last three as buttons that redraw the card
// for that term. CodeMirror keeps a hover tooltip open while the pointer is
// inside it, so the tree can be walked here; Escape closes it.
const d3fendHoverTooltip = hoverTooltip(
  (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const tok = matchTermToken(line.text, pos - line.from);
    if (!tok) return null;
    if (!getItem(tok.name)) return null;

    return {
      pos: line.from + tok.start,
      end: line.from + tok.end,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-d3fend-hover';
        // Navigation redraws inside the same tooltip rather than opening
        // anything: the tooltip is anchored to the hovered token, and a term two
        // clicks away has no position in the document to anchor to.
        const show = (target) => {
          const card = renderD3fendCard(target, { onNavigate: show });
          if (card) dom.replaceChildren(card);
        };
        show(tok.name);
        return { dom };
      },
    };
  },
  { hideOn: (tr) => tr.effects.some((e) => e.is(dismissHover)) },
);

// `run` returns false so the key keeps working for everything else bound to it:
// this handler only ever asks the tooltip to go away. Escape reaches it at all
// because `completionKeymap` runs at Prec.highest and passes it on when no
// completion list is open.
const dismissKeymap = keymap.of([
  {
    key: 'Escape',
    run: (view) => {
      view.dispatch({ effects: dismissHover.of(null) });
      return false;
    },
  },
]);

export const d3fendHover = [d3fendHoverTooltip, dismissKeymap];
