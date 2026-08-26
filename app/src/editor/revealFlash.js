import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

/** How long a revealed range stays lit. Matches viz/graphPane.js's edge toast. */
export const FLASH_MS = 2000;

/** Light up `{ from, to }`, or clear the flash with `null`. */
export const flashRange = StateEffect.define();

const LINE_DECO = Decoration.line({ class: 'cm-goto-source-line' });
const TOKEN_DECO = Decoration.mark({ class: 'cm-goto-source-token' });

const flashField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(flashRange)) continue;
      if (!effect.value) return Decoration.none;
      const { from, to } = effect.value;
      // `true` sorts them: the line decoration can start at the same offset as
      // the mark when the token is the first thing on the line.
      return Decoration.set(
        [
          LINE_DECO.range(tr.state.doc.lineAt(from).from),
          ...(to > from ? [TOKEN_DECO.range(from, to)] : []),
        ],
        true,
      );
    }
    // An edit means the user has moved on, and the range may no longer mean
    // what it did; anything else just needs the positions kept current.
    return tr.docChanged ? Decoration.none : value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * A brief highlight on the range a "go to mermaid source" jump landed on.
 *
 * The selection alone is not enough of a signal when the editor did not have
 * focus a moment ago and the eye is still on the graph — this says "here",
 * then gets out of the way. Colours live in editorTheme.js with the other
 * decorations.
 */
export const revealFlash = [flashField];
