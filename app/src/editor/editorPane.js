import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, tooltips } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap, startCompletion } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { completionPanel } from './completionPanel.js';
import { d3fendCompletionSource } from './d3fendCompletion.js';
import { d3fendHover } from './d3fendHover.js';
import { editorDarkTheme } from './editorTheme.js';
import { documentSymbols } from './documentSymbols.js';
import { relationInsertion } from './insertMeasure.js';
import { mermaidBlockHighlight } from './mermaidBlocks.js';
import { knownNodeHighlight } from './knownNodes.js';
import { linkErrorHighlight } from './linkErrors.js';
import { nodeCompletionSource } from './nodeCompletion.js';
import { FLASH_MS, flashRange, revealFlash } from './revealFlash.js';
import {
  collectSourceLocations,
  edgeLocationsFor,
  pickSourceLocation,
  sourceLocationsFor,
} from './sourceLocations.js';

const DEBOUNCE_MS = 200;
// Long enough that a typing burst produces one re-parse instead of a stream of
// syntax errors, short enough that the graph never looks disconnected. Ctrl+Enter
// and blur flush immediately, so this is the ceiling, not the usual wait.
const TURTLE_DEBOUNCE_MS = 3000;

// Some Linux desktop setups reserve Ctrl+Space for IME input-mode switching,
// so CodeMirror never receives it. Keep Ctrl+Space and add fallbacks that do
// not depend on OS-level key routing.
const COMPLETION_TRIGGER_KEYS = [
  { key: 'Ctrl-Space', run: startCompletion },
  { key: 'Mod-Shift-Space', run: startCompletion },
  { key: 'Ctrl-.', run: startCompletion },
  // Tab only ever *shows* the list; Enter accepts, as `completionKeymap` has it.
  // Not `acceptCompletion() || startCompletion()`: a session stays alive while the
  // typed text still satisfies its `validFor`, so on `d3f:a` that order accepted
  // the preselected first row instead of narrowing the list.
  { key: 'Tab', run: startCompletionAtWord },
];

// Word-like text before the caret, i.e. a position where either completion source
// might have something to offer. Tab elsewhere — indentation, a blank line — is
// left unhandled so it keeps its default focus-escape, which keyboard-only
// navigation needs to get out of the editor.
const COMPLETABLE_PREFIX = /[\w:-]$/;

// Where every editor's tooltips are rendered: the completion list, the hover card
// and the completion `info` pane. Created on first use and shared by all panes.
//
// Not `document.body`, which is what this used to pass: CodeMirror appends one
// `position: relative` container per editor to whatever parent it is given, and
// `body` is a `height: 100vh; display: grid; overflow: hidden` workbench
// (styles/app.css). Those containers landed in an implicit grid row past the
// bottom edge, so the tooltips they hold were positioned into a clipped box
// nobody could see — the panel was in the DOM and invisible.
//
// A fixed, zero-size host pinned to the viewport origin is in no grid, clips
// nothing, and puts the container's rect at (0, 0), which makes the offsets
// CodeMirror writes plain viewport coordinates. Its `z-index` is what keeps the
// panel above the pane chrome.
let tooltipHostEl = null;

function tooltipHost() {
  if (!tooltipHostEl) {
    tooltipHostEl = document.createElement('div');
    tooltipHostEl.id = 'cm-tooltip-host';
    document.body.appendChild(tooltipHostEl);
  }
  return tooltipHostEl;
}

function startCompletionAtWord(view) {
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  if (!COMPLETABLE_PREFIX.test(line.text.slice(0, head - line.from))) return false;
  return startCompletion(view);
}

/**
 * Mounts a CodeMirror editor into `host`. Calls `onChange(text)` debounced after
 * each edit. `extensions` are appended so a caller can add its own language
 * helpers, and `keyBindings` are appended to the shared keymap, keeping the
 * precedence the mermaid pane has always had.
 *
 * A pane that must *override* one of the shared bindings passes its own
 * `keymap.of(...)` in `extensions` instead: extensions come before the shared
 * keymap, and earlier extensions win. That is how the SPARQL pane takes
 * Mod-Enter for "run this query" without reordering anything here.
 */
function createTextEditor(
  host,
  initialText,
  onChange,
  { debounceMs = DEBOUNCE_MS, extensions = [], keyBindings = [] } = {},
) {
  let timer = null;
  let silent = false;
  let flashTimer = null;

  const flush = () => {
    if (!timer) return false;
    clearTimeout(timer);
    timer = null;
    onChange(view.state.doc.toString());
    return true;
  };

  const view = new EditorView({
    state: EditorState.create({
      doc: initialText,
      extensions: [
        lineNumbers(),
        history(),
        editorDarkTheme,
        // Tooltips (the completion list, hover, hierarchy info) render into
        // `#cm-tooltip-host` rather than into `.cm-editor`, so no pane's `overflow`
        // can clip them: `#editor-host` and `#query-host` both scroll, and a list
        // opened near the bottom of a pane is exactly where a long list opens.
        // See tooltipHost() for why that host is not `document.body` itself.
        // CodeMirror copies the view's theme classes onto the container it
        // creates, so the dark theme still applies.
        tooltips({ parent: tooltipHost() }),
        search({ top: true }),
        highlightSelectionMatches(),
        // Here rather than in createEditorPane's list: `revealRange` below is
        // generic, so what draws its flash has to be too.
        revealFlash,
        ...extensions,
        keymap.of([
          { key: 'Mod-Enter', run: () => (flush(), true) },
          // Before defaultKeymap so Mod-f/Mod-Alt-f/F3 reach the search panel.
          ...searchKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...keyBindings,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || silent) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            onChange(view.state.doc.toString());
          }, debounceMs);
        }),
        // Leaving the pane is a natural "I'm done" signal — waiting out the
        // debounce after a click elsewhere just looks broken.
        EditorView.domEventHandlers({ blur: () => void flush() }),
        EditorView.lineWrapping,
      ],
    }),
    parent: host,
  });

  return {
    getText: () => view.state.doc.toString(),
    /** Where the caret is, as a document offset. */
    caretPos: () => view.state.selection.main.head,
    /**
     * Scrolls `{ from, to }` into the middle of the pane, selects it, takes
     * focus and lights it up for FLASH_MS. False when the range is out of
     * bounds, so a caller working from a stale position fails visibly.
     */
    revealRange: ({ from, to }, { focus = true, flash = true } = {}) => {
      const max = view.state.doc.length;
      if (from < 0 || to > max || to < from) return false;
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: [
          EditorView.scrollIntoView(from, { y: 'center' }),
          flashRange.of(flash ? { from, to } : null),
        ],
      });
      // Focus does not fire the blur handler below, so the debounce is untouched.
      if (focus) view.focus();
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = flash
        ? setTimeout(() => {
            flashTimer = null;
            view.dispatch({ effects: flashRange.of(null) });
          }, FLASH_MS)
        : null;
      return true;
    },
    /**
     * `silent` writes without reporting back — for text this editor itself
     * produced, which would otherwise loop straight back through `onChange`.
     */
    setText: (text, options = {}) => {
      if (text === view.state.doc.toString()) return;
      if (options.silent && timer) {
        clearTimeout(timer);
        timer = null;
      }
      silent = Boolean(options.silent);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      silent = false;
    },
    /**
     * A targeted write, `{ from, insert }` as CodeMirror wants it. Not `setText`:
     * one change is one undo step and leaves the rest of the document — and the
     * caret — alone. It reports back through the usual debounced `onChange`.
     */
    insertAt: ({ from, insert }) => {
      if (from < 0 || from > view.state.doc.length) return false;
      view.dispatch({ changes: { from, insert } });
      return true;
    },
    flush,
    /**
     * Re-measures after the pane is shown or moved. CodeMirror caches the
     * geometry it read while the pane was `display: none` — where every box is
     * zero — and would otherwise keep scrolling and wrapping against it.
     */
    requestMeasure: () => view.requestMeasure(),
    hasFocus: () => view.hasFocus,
    focus: () => view.focus(),
  };
}

/**
 * The one preference no `EditorView` ever sees: the text size of all three panes,
 * written as `--editor-fs` on the root element and read by the `.cm-editor` rule
 * in styles/app.css. On the root rather than per host because the three editors
 * share the single "Editor text size" slider (viz/prefsPanel.js).
 *
 * The caller re-measures afterwards: CodeMirror caches character metrics, so a
 * font change alone leaves wrapping and caret placement on the old numbers.
 */
export function applyEditorFontSize(size) {
  document.documentElement.style.setProperty('--editor-fs', `${size}px`);
}

/**
 * The mermaid authoring surface: a plain-text editor with the D3FEND completion,
 * hover and hierarchy helpers. This is the only diagram authoring surface —
 * there is no visual/drag-and-drop builder anywhere in the app.
 *
 * The block tinting, the known-id colouring and the document-node completions
 * all read the same `documentSymbols` index. They are display and input
 * affordances only: the RDF emitted from this text is byte-for-byte what it
 * was without them.
 *
 * `hasSource`/`revealSource` and their edge counterparts answer "where is this
 * written?" for something the user clicked in the graph. They read the live
 * text on demand rather than riding along with the parse, so a position can
 * never be stale, and nothing about the source reaches the RDF store or the
 * graph view (docs/adr/0014-graph-view-from-rdf-only.md).
 */
export function createEditorPane(host, initialText, onChange) {
  const pane = createTextEditor(host, initialText, onChange, {
    extensions: [
      documentSymbols,
      mermaidBlockHighlight,
      knownNodeHighlight,
      linkErrorHighlight,
      autocompletion({
        override: [d3fendCompletionSource, nodeCompletionSource],
        // Ctrl+Space is the completion key (bound by completionKeymap). Without
        // this, a 4664-entry ontology list reopens on every keystroke.
        activateOnTyping: false,
      }),
      // Draws the list. The popup CodeMirror would otherwise open is suppressed in
      // editorTheme.js — see completionPanel.js for why the list is a panel.
      completionPanel,
      d3fendHover,
    ],
    keyBindings: [...COMPLETION_TRIGGER_KEYS, ...completionKeymap],
  });

  // Fire once immediately so the app has content on load.
  onChange(initialText);

  // Built on demand and cached against the text it was built from. Not a
  // StateField: the other indexes recompute per keystroke because their
  // consumers run per keystroke, whereas this one is read on a hover or a
  // right-click — a third full-document scan per keystroke would be waste.
  let cachedText = null;
  let cachedIndex = null;
  const index = () => {
    const text = pane.getText();
    if (text !== cachedText) {
      cachedText = text;
      cachedIndex = collectSourceLocations(text);
    }
    return cachedIndex;
  };

  /** Reveals the next location in `locations`, cycling from where the caret is. */
  const reveal = (locations) => {
    const target = pickSourceLocation(locations, pane.caretPos());
    return target ? pane.revealRange(target) : false;
  };

  return {
    ...pane,
    hasSource: (mermaidId) => sourceLocationsFor(index(), mermaidId).length > 0,
    revealSource: (mermaidId) => reveal(sourceLocationsFor(index(), mermaidId)),
    /** `keys` because one drawn edge can stand for several written ones. */
    hasEdgeSource: (keys) => edgeLocationsFor(index(), keys).length > 0,
    revealEdgeSource: (keys) => reveal(edgeLocationsFor(index(), keys)),
    /**
     * Writes a D3FEND relation of the node written as `mermaidId` into the
     * diagram, below where that node is declared. False when the id is not in
     * the text — the same condition `hasSource` answers, so a caller that asked
     * first never sees it.
     */
    addRelation: (mermaidId, rel) => {
      const change = relationInsertion(pane.getText(), mermaidId, rel);
      return change ? pane.insertAt(change) : false;
    },
  };
}

/**
 * The TriG editing surface. No D3FEND helpers — they are written for the mermaid
 * syntax — and a long debounce, since half-typed RDF is invalid far more often
 * than half-typed mermaid.
 */
export function createTurtlePane(host, initialText, onChange) {
  return createTextEditor(host, initialText, onChange, { debounceMs: TURTLE_DEBOUNCE_MS });
}

/**
 * The SPARQL editing surface.
 *
 * Unlike the other two panes, typing here changes nothing: a query runs only when
 * asked, because running one costs a worker round-trip over ~130k ontology triples
 * and half a query matches everything. So there is no debounce and no `onChange` —
 * `onRun` is the entire contract, bound to Mod-Enter and to the Run button.
 *
 * The binding goes in `extensions` rather than `keyBindings` so it outranks the
 * shared Mod-Enter, which flushes a debounce this pane does not have.
 *
 * `onSave` rides in the same array, on Mod-s. `preventDefault` is what stops the
 * browser's Save-page dialog, and the extension's precedence is what stops the
 * key reaching it at all while the SPARQL editor has focus.
 *
 * It keeps the d3f: completions: the class names are the same ones the mermaid
 * pane completes, and they are exactly what is hard to type from memory. The node
 * completions are left out — they read the mermaid document symbols, which say
 * nothing about a query.
 */
export function createSparqlPane(host, initialText, onRun, onSave) {
  return createTextEditor(host, initialText, () => {}, {
    debounceMs: 0,
    extensions: [
      keymap.of([
        { key: 'Mod-Enter', run: () => (onRun(), true) },
        { key: 'Mod-s', preventDefault: true, run: () => (onSave?.(), true) },
      ]),
      autocompletion({ override: [d3fendCompletionSource], activateOnTyping: false }),
      completionPanel,
      d3fendHover,
    ],
    keyBindings: [...COMPLETION_TRIGGER_KEYS, ...completionKeymap],
  });
}
