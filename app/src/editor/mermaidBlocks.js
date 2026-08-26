import { RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

const OPEN_RE = /^\s*```mermaid\b/;
const CLOSE_RE = /^\s*```\s*$/;

/**
 * Line spans of every ```mermaid fenced block, 1-based and inclusive of both
 * fence lines: `[{ fromLine, toLine }]`. `toLine` is the last line of the
 * document when a block is left unterminated, so a block being typed is
 * highlighted from the moment its opening fence exists.
 *
 * Line-based rather than reusing `extractMermaidBlocks`'s regex because
 * decorations are addressed by line, and because that regex silently drops an
 * unterminated block.
 */
export function mermaidBlockLines(text) {
  const lines = text.split('\n');
  const blocks = [];
  let open = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (open === null) {
      if (OPEN_RE.test(line)) open = lineNumber;
      return;
    }
    if (CLOSE_RE.test(line)) {
      blocks.push({ fromLine: open, toLine: lineNumber });
      open = null;
    }
  });

  if (open !== null) blocks.push({ fromLine: open, toLine: lines.length });
  return blocks;
}

/** State field holding the current block spans; recomputed on every doc change. */
export const mermaidBlocksField = StateField.define({
  create: (state) => mermaidBlockLines(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? mermaidBlockLines(tr.state.doc.toString()) : value),
});

const FRONTMATTER_FENCE = /^\s*---\s*$/;

/**
 * Calls `fn(line, block)` for every content line of every ```mermaid block —
 * `line` a CodeMirror `Line`, `block` the block's index. Fence lines and the
 * per-block `---` frontmatter are skipped, so what `fn` sees is what the
 * tokenizer sees.
 *
 * Whole blocks at a time even when only part of one is on screen: the
 * frontmatter state machine has to start at the opening fence, and blocks are
 * small. `skipBlock(from, to)` — document offsets — is how a caller drops a
 * block that is nowhere near the viewport.
 */
export function forEachMermaidBodyLine(state, fn, { skipBlock } = {}) {
  const blocks = state.field(mermaidBlocksField);
  const { doc } = state;

  blocks.forEach(({ fromLine, toLine }, block) => {
    const blockFrom = doc.line(fromLine).from;
    const blockTo = doc.line(Math.min(toLine, doc.lines)).to;
    if (skipBlock && skipBlock(blockFrom, blockTo)) return;

    let seenFence = 0;
    let inFrontmatter = false;
    for (let n = fromLine + 1; n < toLine; n++) {
      const line = doc.line(n);
      if (seenFence < 2 && FRONTMATTER_FENCE.test(line.text)) {
        seenFence++;
        inFrontmatter = seenFence === 1;
        continue;
      }
      if (inFrontmatter) continue;
      fn(line, block);
    }
  });
}

/**
 * A `skipBlock` predicate that drops the blocks no part of which is on screen —
 * what a decoration builder wants, since it only has to cover the viewport.
 */
export function offscreen(view) {
  const viewFrom = view.visibleRanges[0]?.from ?? 0;
  const viewTo = view.visibleRanges[view.visibleRanges.length - 1]?.to ?? 0;
  return (from, to) => to < viewFrom || from > viewTo;
}

/** `'fence' | 'body' | null` for a 1-based line number. */
export function mermaidLineKind(blocks, lineNumber) {
  for (const { fromLine, toLine } of blocks) {
    if (lineNumber < fromLine || lineNumber > toLine) continue;
    return lineNumber === fromLine || lineNumber === toLine ? 'fence' : 'body';
  }
  return null;
}

const BODY_DECO = Decoration.line({ class: 'cm-mermaid-block' });
const FENCE_DECO = Decoration.line({ class: 'cm-mermaid-fence' });

function buildDecorations(view) {
  const blocks = view.state.field(mermaidBlocksField);
  const builder = new RangeSetBuilder();
  if (!blocks.length) return builder.finish();

  // visibleRanges are ascending and disjoint, so walking them line by line
  // feeds the builder in the order it requires.
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const kind = mermaidLineKind(blocks, line.number);
      if (kind) builder.add(line.from, line.from, kind === 'fence' ? FENCE_DECO : BODY_DECO);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * Tints ```mermaid blocks so the diagram source stands out from the prose
 * around it. Purely visual — the parser still finds blocks its own way.
 */
export const mermaidBlockHighlight = [
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
  EditorView.baseTheme({
    '.cm-mermaid-block': { backgroundColor: '#f1f3f5' },
    '.cm-mermaid-fence': { backgroundColor: '#e9ecef' },
  }),
];
