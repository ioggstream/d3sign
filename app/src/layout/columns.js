/**
 * Renders a layout (layout/model.js) into the three-column grid, and is the only
 * thing in the app that moves a pane.
 *
 * The one rule that shapes everything here: **a pane element is mounted once and
 * never unmounted.** Moving a view is `appendChild` of the element that is
 * already there — never a rebuild. A rebuilt container would mean a new
 * cytoscape instance and a new CodeMirror EditorView, so the drawing's zoom, the
 * editor's undo history and the TriG pane's dirty state would all be lost on
 * every move. The old `setTurtleFolded` already worked this way; this
 * generalises it to every view (docs/adr/0022-column-tab-groups.md).
 *
 * There is no test for this module: the suite runs in node with no jsdom, and
 * everything worth asserting was pushed into the model, which is pure.
 */

import {
  columnOfView,
  createDefaultLayout,
  isViewVisible,
  moveView,
  moveViewBy,
  renderedFractions,
  setActiveTab,
  setWeights,
} from './model.js';
import { clearLayout, loadLayout, saveLayout } from './persist.js';
import { makeResizableGutter } from './resizer.js';

const GUTTER_PX = 6;
/** Below this a column is too narrow to read; the drag stops rather than collapsing it. */
const MIN_COLUMN_PX = 200;

/**
 * A view definition (the caller's registry):
 *
 *   id            stable, persisted, and the key the shortcut table uses
 *   title         the tab label
 *   shortcut      KeyboardEvent.code for Alt+<key>, or absent for no shortcut
 *   keyHint       what the tab prints, when the key is not an Alt+<letter>
 *   hint          the tab's tooltip (defaults to the title)
 *   element       the pane element, already in the document
 *   defaultColumn where it goes for a first-time user
 *   defaultActive whether it is the tab that column shows
 *   homeColumn    where `cycleView` sends it back to (defaults to defaultColumn)
 *   onShow()      it just became the visible tab of its column
 *   onMove({hadFocus})  its DOM parent just changed
 */
export function createColumnLayout({ grid, columnEls, gutterEls, views }) {
  const byId = new Map(views.map((v) => [v.id, v]));
  let layout = loadLayout(views);
  // Skipped on the first render: the panes have not been built yet, so there is
  // nothing to re-measure and no focus to restore.
  let rendered = false;

  /**
   * Which two columns each gutter divides, skipping empty ones.
   *
   * With a column empty its two gutters would otherwise sit side by side as 12px
   * of dead space, and dragging either would move width into a column that is
   * not on screen — which is exactly the bug the old pixel-parsing resizer had.
   * So only the gutter to the left of each adjacent pair is live; the rest
   * collapse to zero width.
   */
  function gutterPairs() {
    const filled = layout.columns.map((c, i) => (c.views.length ? i : -1)).filter((i) => i >= 0);
    const pairs = new Map();
    for (let k = 0; k < filled.length - 1; k += 1) pairs.set(filled[k], [filled[k], filled[k + 1]]);
    return pairs;
  }

  /** Column widths and gutter presence — the part a drag re-runs on every move. */
  function renderSizes() {
    const fractions = renderedFractions(layout);
    const pairs = gutterPairs();
    const tracks = [];
    fractions.forEach((fraction, i) => {
      if (i > 0) tracks.push(pairs.has(i - 1) ? `${GUTTER_PX}px` : '0px');
      tracks.push(`${fraction}fr`);
    });
    grid.style.gridTemplateColumns = tracks.join(' ');
    columnEls.forEach((el, i) => el.classList.toggle('col--empty', !layout.columns[i].views.length));
    gutterEls.forEach((el, i) => el.classList.toggle('gutter--disabled', !pairs.has(i)));
  }

  function tabButton(view, selected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `tab-${view.id}`;
    button.className = 'tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', view.element.id);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.title = view.hint ?? view.title;
    button.append(view.title);
    // Printed on the tab from the same field the shortcut table reads, so the
    // two cannot drift apart — the failure ADR 0013 calls out by name.
    const hint = view.keyHint ?? (view.shortcut ? `Alt+${view.shortcut.replace(/^Key/, '')}` : null);
    if (hint) {
      const key = document.createElement('span');
      key.className = 'tab-key';
      key.textContent = hint;
      button.append(' ', key);
    }
    button.addEventListener('click', () => {
      layout = setActiveTab(layout, view.id);
      commit();
    });
    return button;
  }

  /** Tab bars, pane parents and visibility. */
  function renderContent() {
    // Read before anything moves: re-parenting an element blurs whatever inside
    // it had focus, and a view that had the caret should still have it after.
    const focused = views.filter((v) => v.element.contains(document.activeElement)).map((v) => v.id);
    const shown = [];
    const moved = [];

    layout.columns.forEach((column, i) => {
      const columnEl = columnEls[i];
      const tabBar = columnEl.querySelector('.tab-bar');
      tabBar.replaceChildren();
      for (const viewId of column.views) {
        const view = byId.get(viewId);
        if (!view) continue;
        tabBar.append(tabButton(view, column.active === viewId));
        if (view.element.parentElement !== columnEl) {
          moved.push(view);
          columnEl.append(view.element);
        }
        view.element.setAttribute('aria-labelledby', `tab-${view.id}`);
        const visible = column.active === viewId;
        if (visible && view.element.hidden) shown.push(view);
        view.element.hidden = !visible;
      }
    });

    if (!rendered) return;
    for (const view of moved) view.onMove?.({ hadFocus: focused.includes(view.id) });
    for (const view of shown) view.onShow?.();
  }

  function commit() {
    renderSizes();
    renderContent();
    saveLayout(layout);
  }

  columnEls.forEach((el) => {
    if (!el.querySelector('.tab-bar')) {
      const bar = document.createElement('div');
      bar.className = 'tab-bar';
      bar.setAttribute('role', 'tablist');
      el.prepend(bar);
    }
  });

  gutterEls.forEach((gutter, i) => {
    makeResizableGutter(gutter, {
      container: grid,
      axis: 'column',
      min: MIN_COLUMN_PX,
      // Resolved per drag, not per gutter: which columns are adjacent depends on
      // which ones are currently empty.
      beforeIndex: () => gutterPairs().get(i)?.[0] ?? 0,
      afterIndex: () => gutterPairs().get(i)?.[1] ?? 0,
      getSizes: () => renderedFractions(layout),
      // Only the widths, not the tab bars: a drag would otherwise rebuild every
      // tab button on every pointermove. The debounced save collapses the burst.
      setSizes: (sizes) => {
        layout = setWeights(layout, sizes);
        renderSizes();
        saveLayout(layout);
      },
    });
  });

  renderSizes();
  renderContent();
  rendered = true;

  return {
    /** Whether `viewId` is the visible tab of its column — what the shortcuts gate on. */
    isVisible: (viewId) => isViewVisible(layout, viewId),
    /** The view the move commands act on. */
    activeView: () => layout.activeView,
    /** Brings a view on screen, wherever it lives. */
    revealView(viewId) {
      layout = setActiveTab(layout, viewId);
      commit();
    },
    /** Moves a view one column left (-1) or right (+1) and shows it there. */
    moveActiveViewBy(delta) {
      layout = moveViewBy(layout, layout.activeView, delta);
      commit();
    },
    /** Puts keyboard focus on a view's tab button, for the Alt+<key> shortcuts. */
    focusTab(viewId) {
      document.getElementById(`tab-${viewId}`)?.focus();
    },
    /**
     * The three-state cycle Alt+, has always had for the TriG pane, generalised:
     * its own column → a tab beside the others → that tab selected → its own
     * column again (docs/adr/0013-graph-view-controls.md). So one key both frees
     * the width and brings the pane back.
     */
    cycleView(viewId) {
      const view = byId.get(viewId);
      if (!view) return;
      const home = view.homeColumn ?? view.defaultColumn ?? 0;
      const away = view.defaultColumn ?? 0;
      const at = columnOfView(layout, viewId);
      if (at === home && home !== away) {
        // Fold: the destination keeps the tab it was showing, so the width the
        // fold just freed goes to what the user was already looking at.
        const keep = layout.columns[away].active;
        layout = moveView(layout, viewId, away);
        if (keep) layout = setActiveTab(layout, keep);
      } else if (!isViewVisible(layout, viewId)) {
        layout = setActiveTab(layout, viewId);
      } else {
        layout = moveView(layout, viewId, home);
      }
      commit();
    },
    /** Forgets the saved arrangement and goes back to the shipped one. */
    reset() {
      clearLayout();
      layout = createDefaultLayout(views);
      commit();
    },
  };
}
