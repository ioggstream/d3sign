import { showPanel } from '@codemirror/view';
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
} from '@codemirror/autocomplete';

/**
 * The completion list, as a panel at the top of the editor rather than as
 * CodeMirror's caret-anchored popup.
 *
 * Why: the popup is a tooltip, and a tooltip is positioned by measurement — the
 * editor's rect, the caret's coordinates, the tooltip parent's rect, the space
 * left in the viewport. Every one of those is a way for the list to end up
 * off-screen or clipped while the completion session itself is perfectly alive,
 * which is exactly what happened here (see lessons.md, 2026-08-13). A panel is
 * laid out by the browser inside `.cm-editor`, the way the search panel is, so
 * there is nothing to measure and nowhere for it to hide: it is either open at
 * the top of the pane or closed.
 *
 * The trade is that the list is no longer next to the caret, and that it takes
 * a strip of editor height while open. Both are deliberate — always visible in
 * one known place beats near the caret and sometimes invisible.
 *
 * The panel is state-driven: `currentCompletions` and `selectedCompletionIndex`
 * are the same state CodeMirror's own popup reads, so the keys keep working
 * untouched — `completionKeymap` moves the selection, Enter accepts, Escape
 * closes, and this only draws what the state says.
 */

// CodeMirror's popup renders at most 100 rows for the same reason: typing a bare
// `d3f:` matches 4662 options, and building that many rows on every keystroke is
// the one part of this that would actually be slow. The count tells the user the
// list is truncated, so a missing term means "type more", not "not in D3FEND".
const MAX_ROWS = 100;

/**
 * The text for the pane beside the list.
 *
 * `infoText` is this project's own field, not CodeMirror's `info`, and the options
 * carry no `info` at all — deliberately. CodeMirror only accepts a Node from a
 * function-valued `info`, a string thrown from ours, and the throw happened inside
 * the tooltip plugin, which CodeMirror deactivates on a crash: one completion took
 * out the popup *and* every hover card until the page was reloaded. Keeping the text
 * under a field the library never reads means the popup builds no info pane, so
 * there is nothing left to get the contract wrong about — and the value stays a
 * plain lazy string, which the tests can call without a DOM.
 */
function infoText(completion) {
  const { infoText: info } = completion;
  if (typeof info === 'string') return info;
  if (typeof info !== 'function') return '';
  const value = info(completion);
  return typeof value === 'string' ? value : '';
}

function createPanel(view) {
  const dom = document.createElement('div');
  dom.className = 'cm-completion-panel';

  const list = document.createElement('div');
  list.className = 'cm-completion-panel-list';
  list.setAttribute('role', 'listbox');

  const info = document.createElement('div');
  info.className = 'cm-completion-panel-info';

  dom.append(list, info);

  // What the last render drew, so an update that changed neither the options nor
  // the selection — a scroll, a click elsewhere, any of the many updates a typing
  // session produces — does not rebuild the rows.
  let drawn = null;

  const render = (state) => {
    // `completionStatus` says "active" from the moment a source is queried, which is
    // before there are options to draw and, when a source declines, instead of a
    // list there never is one. Having options is the condition worth drawing on.
    const options = completionStatus(state) === 'active' ? currentCompletions(state) : [];
    const active = options.length > 0;
    const selected = active ? (selectedCompletionIndex(state) ?? -1) : -1;
    const key = active ? `${options.length}:${selected}:${options[0]?.label ?? ''}` : null;
    if (key === drawn) return;
    drawn = key;

    // `hidden` rather than removing the panel: a panel that comes and goes makes
    // the editor's height jump on every keystroke of a session, and CodeMirror
    // measures a hidden panel as zero height, so the closed state costs nothing.
    dom.hidden = !active;
    if (!active) {
      list.replaceChildren();
      info.replaceChildren();
      return;
    }

    const rows = [];
    let section = null;
    options.slice(0, MAX_ROWS).forEach((completion, index) => {
      const name = completion.section?.name ?? completion.section ?? null;
      if (name && name !== section) {
        section = name;
        const header = document.createElement('div');
        header.className = 'cm-completion-panel-section';
        header.textContent = name;
        rows.push(header);
      }

      const row = document.createElement('div');
      row.className = 'cm-completion-panel-row';
      row.setAttribute('role', 'option');
      if (index === selected) {
        row.setAttribute('aria-selected', 'true');
        row.dataset.selected = 'true';
      }

      const label = document.createElement('span');
      label.className = 'cm-completion-panel-label';
      label.textContent = completion.label;
      row.append(label);

      if (completion.detail) {
        const detail = document.createElement('span');
        detail.className = 'cm-completion-panel-detail';
        detail.textContent = completion.detail;
        row.append(detail);
      }

      // mousedown, and prevented: a click would move focus out of the editor
      // first, and `closeOnBlur` would close the session before the click landed.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        view.dispatch({ effects: setSelectedCompletion(index) });
        acceptCompletion(view);
        view.focus();
      });

      rows.push(row);
    });

    if (options.length > MAX_ROWS) {
      const more = document.createElement('div');
      more.className = 'cm-completion-panel-more';
      more.textContent = `…and ${options.length - MAX_ROWS} more — keep typing to narrow`;
      rows.push(more);
    }

    list.replaceChildren(...rows);
    info.textContent = selected >= 0 ? infoText(options[selected]) : '';
    // The selection is moved by the keyboard, so the row it lands on has to come
    // into view on its own.
    list.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  };

  render(view.state);

  return {
    dom,
    top: true,
    update: (update) => render(update.state),
  };
}

/**
 * The extension. Always present, and `hidden` unless a completion session is
 * open — see createPanel for why it is not added and removed instead.
 */
export const completionPanel = showPanel.of(createPanel);
