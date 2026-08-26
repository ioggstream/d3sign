import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { ID_RE } from '../parser/nodeParser.js';
import { getSymbols } from './documentSymbols.js';
import { maskMermaidLine } from './mermaidMasking.js';
import { forEachMermaidBodyLine, offscreen } from './mermaidBlocks.js';

const TOKEN_RE = new RegExp(ID_RE, 'g');

const KNOWN = Decoration.mark({ class: 'cm-known-node' });
const KNOWN_TAGGED = Decoration.mark({ class: 'cm-known-node-tagged' });

function buildDecorations(view) {
  const symbols = getSymbols(view.state);
  const builder = new RangeSetBuilder();
  if (!symbols.size) return builder.finish();

  forEachMermaidBodyLine(
    view.state,
    (line) => {
      const masked = maskMermaidLine(line.text);
      TOKEN_RE.lastIndex = 0;
      let match;
      while ((match = TOKEN_RE.exec(masked))) {
        const entry = symbols.get(match[0]);
        if (!entry) continue;
        const from = line.from + match.index;
        builder.add(from, from + match[0].length, entry.classes.length ? KNOWN_TAGGED : KNOWN);
      }
    },
    { skipBlock: offscreen(view) },
  );

  return builder.finish();
}

/**
 * Colourises node ids that are declared somewhere in the document — in this
 * diagram or any other — with a distinct tint for ids that carry a d3f: class.
 * Editor-only feedback: it changes nothing about what gets emitted as RDF.
 */
export const knownNodeHighlight = [
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.baseTheme({
    '.cm-known-node': { color: '#0b7285' },
    '.cm-known-node-tagged': { color: '#3b5bdb', fontWeight: '600' },
  }),
];
