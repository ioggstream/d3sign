import { EditorView } from '@codemirror/view';

/**
 * Dark theme for the two CodeMirror panes. Scoped to the editors on purpose:
 * the rest of the app (header, graph, mermaid preview) stays on its light
 * palette, so this only inverts the authoring surfaces.
 *
 * Colours mirror the app's Open-Color accents (#4c6ef5) over Mantine-style
 * dark greys, so the editors read as the same product, not a bolted-on theme.
 */
const BG = '#1a1d21';
const BG_LIFTED = '#20242b';
const BG_PANEL = '#25262b';
const FG = '#c1c2c5';
const FG_DIM = '#868e96';
const BORDER = '#373a40';
const ACCENT = '#4c6ef5';

export const editorDarkTheme = EditorView.theme(
  {
    '&': {
      color: FG,
      backgroundColor: BG,
    },
    '.cm-content': {
      caretColor: '#e9ecef',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e9ecef' },
    // CodeMirror paints the selection with .cm-selectionBackground when the
    // view is unfocused and ::selection when focused — both need the override.
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#364fc7',
    },
    '.cm-activeLine': { backgroundColor: '#ffffff08' },
    '.cm-gutters': {
      backgroundColor: '#16181c',
      color: '#5c5f66',
      border: 'none',
      borderRight: `1px solid ${BORDER}`,
    },
    '.cm-activeLineGutter': { backgroundColor: '#ffffff08', color: FG_DIM },
    '.cm-foldPlaceholder': {
      backgroundColor: BG_PANEL,
      border: `1px solid ${BORDER}`,
      color: FG_DIM,
    },

    // --- search & replace panel ---
    '.cm-panels': { backgroundColor: BG_PANEL, color: FG },
    '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${BORDER}` },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${BORDER}` },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
      fontSize: '0.8rem',
    },
    '.cm-panel.cm-search input[type=text]': {
      backgroundColor: BG,
      color: FG,
      border: `1px solid ${BORDER}`,
      borderRadius: '3px',
      padding: '0.15rem 0.3rem',
    },
    '.cm-panel.cm-search button:not([name=close])': {
      backgroundColor: '#2c2e33',
      backgroundImage: 'none',
      color: FG,
      border: `1px solid ${BORDER}`,
      borderRadius: '3px',
      cursor: 'pointer',
    },
    '.cm-panel.cm-search button:not([name=close]):hover': { borderColor: ACCENT },
    '.cm-panel.cm-search button[name=close]': { color: FG },
    '.cm-searchMatch': { backgroundColor: '#5c4b0080', outline: `1px solid #f59f0060` },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#f59f00', color: '#1a1d21' },
    '.cm-selectionMatch': { backgroundColor: '#ffffff14' },

    // --- tooltips: hover, hierarchy info, completion menu ---
    '.cm-tooltip': {
      backgroundColor: BG_PANEL,
      color: FG,
      border: `1px solid ${BORDER}`,
    },
    '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: BORDER, borderBottomColor: BORDER },
    '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: BG_PANEL, borderBottomColor: BG_PANEL },
    // CodeMirror's own caret-anchored completion popup, suppressed: the list is
    // drawn by the panel below (completionPanel.js), and two lists of the same
    // options would compete for the same keys. This also hides the popup's `info`
    // pane, which is a child of it — the panel renders that text itself.
    '.cm-tooltip.cm-tooltip-autocomplete': { display: 'none' },

    // --- completion panel (completionPanel.js) ---
    // A strip at the top of the editor: the list on the left, the selected term's
    // hierarchy on the right. Bounded height, because the list can be 100 rows and
    // the panel takes its space out of the editor's.
    '.cm-panel.cm-completion-panel': {
      display: 'flex',
      alignItems: 'stretch',
      gap: '0.5rem',
      maxHeight: '12rem',
      backgroundColor: BG_PANEL,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '0.8rem',
    },
    // `display: flex` above outranks the UA's `[hidden] { display: none }`, so the
    // closed panel needs saying explicitly or it never closes.
    '.cm-panel.cm-completion-panel[hidden]': { display: 'none' },
    '.cm-completion-panel-list': { flex: '1 1 60%', overflow: 'auto', minWidth: '0' },
    '.cm-completion-panel-row': {
      color: FG,
      padding: '0.1rem 0.4rem',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    '.cm-completion-panel-row[data-selected]': { backgroundColor: ACCENT, color: '#fff' },
    '.cm-completion-panel-section': {
      backgroundColor: '#16181c',
      color: FG_DIM,
      borderBottom: `1px solid ${BORDER}`,
      padding: '0.1rem 0.4rem',
      position: 'sticky',
      top: '0',
    },
    '.cm-completion-panel-detail': { color: FG_DIM, marginLeft: '0.6rem' },
    '.cm-completion-panel-row[data-selected] .cm-completion-panel-detail': { color: '#dbe4ff' },
    '.cm-completion-panel-more': { color: FG_DIM, padding: '0.1rem 0.4rem' },
    '.cm-completion-panel-info': {
      flex: '1 1 40%',
      overflow: 'auto',
      borderLeft: `1px solid ${BORDER}`,
      padding: '0.1rem 0.5rem',
      color: FG_DIM,
      whiteSpace: 'pre-wrap',
    },

    // --- mermaid fenced blocks (see mermaidBlocks.js) ---
    '.cm-mermaid-block': {
      backgroundColor: BG_LIFTED,
      boxShadow: `inset 3px 0 0 ${ACCENT}`,
    },
    '.cm-mermaid-fence': {
      backgroundColor: '#1d2229',
      boxShadow: `inset 3px 0 0 ${ACCENT}`,
      color: FG_DIM,
    },

    // --- ids already declared somewhere in the document (see knownNodes.js) ---
    '.cm-known-node': {
      color: '#63e6be',
      borderBottom: '1px dotted #63e6be80',
    },
    '.cm-known-node-tagged': {
      color: '#91a7ff',
      borderBottom: '1px solid #91a7ff80',
    },

    // --- lines mermaid will not render (see linkErrors.js) ---
    // After .cm-mermaid-block on purpose: an error line carries both classes,
    // and this tint has to be the one that shows.
    '.cm-mermaid-error-line': {
      backgroundColor: '#ff6b6b1f',
      boxShadow: 'inset 3px 0 0 #ff6b6b',
    },
    '.cm-mermaid-error': {
      textDecoration: 'underline wavy #ff6b6b',
      textUnderlineOffset: '3px',
    },

    // --- the landing spot of a "go to mermaid source" jump (revealFlash.js) ---
    // The caret lands here too, so this has to read over .cm-activeLine.
    '.cm-goto-source-line': {
      backgroundColor: '#4c6ef533',
      boxShadow: 'inset 3px 0 0 #4c6ef5',
    },
    '.cm-goto-source-token': {
      backgroundColor: '#4c6ef566',
      borderRadius: '2px',
      outline: '1px solid #91a7ff',
    },
  },
  { dark: true },
);
