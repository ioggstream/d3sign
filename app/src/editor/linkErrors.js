import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { backArrowSpans } from '../parser/edgeParser.js';
import { forEachMermaidBodyLine, mermaidBlocksField, offscreen } from './mermaidBlocks.js';

const ERROR_LINE = Decoration.line({ class: 'cm-mermaid-error-line' });
const ERROR_ARROW = Decoration.mark({ class: 'cm-mermaid-error' });

function buildDecorations(view) {
  const builder = new RangeSetBuilder();

  forEachMermaidBodyLine(
    view.state,
    (line) => {
      const spans = backArrowSpans(line.text);
      if (!spans.length) return;
      // The line decoration is added at line.from first: RangeSetBuilder wants
      // ascending positions, and a line decoration has to precede a mark that
      // starts at the same offset.
      builder.add(line.from, line.from, ERROR_LINE);
      for (const { from, to } of spans) {
        builder.add(line.from + from, line.from + to, ERROR_ARROW);
      }
    },
    { skipBlock: offscreen(view) },
  );

  return builder.finish();
}

/**
 * Marks the mermaid lines that will not render: today that means back arrows,
 * `c <--|d3f:reads| d` and friends, which mermaid has no syntax for (see
 * `backArrowSpans` in parser/edgeParser.js — the parser and this share the one
 * definition, and the parser also names the arrow in the lint banner).
 *
 * Editor-only feedback, computed from the live text rather than handed over by
 * the parse: nothing about it reaches the AST, the store or the graph view
 * (docs/adr/0014-graph-view-from-rdf-only.md).
 */
export const linkErrorHighlight = [
  mermaidBlocksField,
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
  // The light fallback. What the authoring panes actually show comes from
  // editorTheme.js, which is dark and overrides both classes.
  EditorView.baseTheme({
    '.cm-mermaid-error-line': { backgroundColor: '#ffe3e3' },
    '.cm-mermaid-error': { textDecoration: 'underline wavy #e03131', textUnderlineOffset: '3px' },
  }),
];
