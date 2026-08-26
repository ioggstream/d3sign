/**
 * The window layout, as plain data.
 *
 * Three fixed columns, each a tab group: a view lives in exactly one column and
 * is the only visible one there when it is that column's `active` tab. Which
 * view sits where is the user's business, so it is state rather than markup —
 * before this, every pane's home was written into index.html and only the TriG
 * pane could move (docs/adr/0022-column-tab-groups.md).
 *
 * Nothing here touches the DOM. layout/columns.js renders a layout and
 * layout/persist.js stores one; both go through these functions, so the model is
 * the only writer and stays testable in node — which matters, since the renderer
 * is not (no jsdom in this test suite).
 */

export const LAYOUT_VERSION = 1;

/** Three, always. A column can be empty, but it is never removed. */
export const COLUMN_COUNT = 3;

/**
 * Column widths as *remembered weights*, not fractions of the window: an empty
 * column takes no width, and the rest share it out in proportion — so folding a
 * column away and bringing it back needs nothing remembered on the side.
 *
 * `[1, 1, 3]` rather than the `1fr 1fr 2fr` the stylesheet used to hardcode,
 * because the app boots with the TriG column empty and 1:3 is the 25/75 split
 * that the old `setTurtleFolded` produced at startup.
 */
export const DEFAULT_WEIGHTS = [1, 1, 3];

/** Below this a column is a sliver with an unreadable tab bar. */
const MIN_WEIGHT = 0.05;

const clampColumn = (index) => Math.min(COLUMN_COUNT - 1, Math.max(0, index | 0));

function emptyColumns() {
  return DEFAULT_WEIGHTS.map((weight) => ({ views: [], active: null, weight }));
}

/** A deep-enough copy that callers can never alias a previous layout's arrays. */
function clone(layout) {
  return {
    version: LAYOUT_VERSION,
    activeView: layout.activeView,
    columns: layout.columns.map((column) => ({
      views: [...column.views],
      active: column.active,
      weight: column.weight,
    })),
  };
}

/**
 * The arrangement a first-time user sees, from the registry's own
 * `defaultColumn`/`defaultActive` declarations — so adding a view means adding
 * one registry entry and nothing here.
 */
export function createDefaultLayout(views) {
  const columns = emptyColumns();
  for (const view of views) columns[clampColumn(view.defaultColumn ?? 0)].views.push(view.id);
  for (const column of columns) {
    const preferred = column.views.find((id) => views.find((v) => v.id === id)?.defaultActive);
    column.active = preferred ?? column.views[0] ?? null;
  }
  const activeView = views.find((v) => v.defaultActive)?.id ?? columns[0].active;
  return { version: LAYOUT_VERSION, activeView, columns };
}

/** Which column holds `viewId`, or -1. */
export function columnOfView(layout, viewId) {
  return layout.columns.findIndex((column) => column.views.includes(viewId));
}

/** Whether `viewId` is the visible tab of its column. */
export function isViewVisible(layout, viewId) {
  return layout.columns.some((column) => column.active === viewId);
}

/**
 * Column widths for the grid: the weights renormalised over the non-empty
 * columns, with an empty column at exactly 0.
 *
 * A zero-width column keeps its grid track rather than being dropped from the
 * layout — see the note on `.col--empty` in app.css.
 */
export function renderedFractions(layout) {
  const total = layout.columns.reduce((sum, c) => sum + (c.views.length ? c.weight : 0), 0);
  if (total <= 0) return layout.columns.map(() => 1 / COLUMN_COUNT);
  return layout.columns.map((c) => (c.views.length ? c.weight / total : 0));
}

/**
 * Writes the fractions a gutter drag produced back as weights. Only the
 * non-empty columns are touched: an empty column's weight is what it will be
 * worth when something is moved into it, and a drag never expressed an opinion
 * about that.
 */
export function setWeights(layout, fractions) {
  const next = clone(layout);
  next.columns.forEach((column, i) => {
    if (!column.views.length) return;
    const value = Number(fractions[i]);
    if (Number.isFinite(value) && value > 0) column.weight = Math.max(MIN_WEIGHT, value);
  });
  return next;
}

/** Makes `viewId` the visible tab of whichever column holds it, and the move target. */
export function setActiveTab(layout, viewId) {
  const index = columnOfView(layout, viewId);
  if (index < 0) return layout;
  const next = clone(layout);
  next.columns[index].active = viewId;
  next.activeView = viewId;
  return next;
}

/**
 * Moves a view into `targetColumn` and shows it there.
 *
 * The column it left falls back to its neighbouring tab rather than to its
 * first: with three or four tabs in a column, "the one next to what just went
 * away" is where the eye already is.
 */
export function moveView(layout, viewId, targetColumn) {
  const from = columnOfView(layout, viewId);
  const to = clampColumn(targetColumn);
  if (from < 0) return layout;
  if (from === to) return setActiveTab(layout, viewId);

  const next = clone(layout);
  const source = next.columns[from];
  const at = source.views.indexOf(viewId);
  source.views.splice(at, 1);
  if (source.active === viewId) {
    source.active = source.views[Math.min(at, source.views.length - 1)] ?? null;
  }
  const target = next.columns[to];
  target.views.push(viewId);
  target.active = viewId;
  next.activeView = viewId;
  return next;
}

/** `moveView` one column left (-1) or right (+1); clamped, so the ends are no-ops. */
export function moveViewBy(layout, viewId, delta) {
  const from = columnOfView(layout, viewId);
  if (from < 0) return layout;
  return moveView(layout, viewId, from + delta);
}

/**
 * Reconciles a stored layout with the views this build actually has.
 *
 * Without this, renaming a view id leaves a tab that opens nothing, and adding
 * a view makes it permanently unreachable for everyone who has ever used the
 * app. Anything unrecognisable falls back to the default rather than throwing:
 * a corrupt layout must never be able to make the app unloadable.
 */
export function migrate(saved, views) {
  const fallback = createDefaultLayout(views);
  if (!saved || saved.version !== LAYOUT_VERSION || !Array.isArray(saved.columns)) return fallback;
  if (saved.columns.length !== COLUMN_COUNT) return fallback;
  if (!saved.columns.every((c) => c && Array.isArray(c.views))) return fallback;

  const known = new Map(views.map((v) => [v.id, v]));
  const placed = new Set();
  const columns = saved.columns.map((column, i) => {
    const kept = column.views.filter((id) => {
      // A duplicate would mount the same element in two columns; first wins.
      if (!known.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    });
    const weight = Number(column.weight);
    return {
      views: kept,
      active: kept.includes(column.active) ? column.active : (kept[0] ?? null),
      weight: Number.isFinite(weight) && weight > 0 ? weight : DEFAULT_WEIGHTS[i],
    };
  });

  // A view added since the layout was saved goes to the home its registry entry
  // asks for, and takes that column's tab — otherwise a new feature would ship
  // invisible to every existing user.
  for (const view of views) {
    if (placed.has(view.id)) continue;
    const column = columns[clampColumn(view.defaultColumn ?? 0)];
    column.views.push(view.id);
    column.active = view.id;
  }

  const activeView = known.has(saved.activeView) ? saved.activeView : fallback.activeView;
  return { version: LAYOUT_VERSION, activeView, columns };
}
