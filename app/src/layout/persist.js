/**
 * localStorage for the window layout, following the same shape as the other view
 * state (viz/graphPrefs.js, viz/graphVisibility.js): read through a normalizer,
 * fall back silently, never let storage break the load.
 *
 * Writes are debounced because a gutter drag would otherwise serialize on every
 * pointermove; the commit at pointerup is what actually matters, and the
 * debounce collapses the rest into it.
 */

import { createDefaultLayout, migrate } from './model.js';

const STORAGE_KEY = 'd3fend-graph:layout';
const SAVE_DEBOUNCE_MS = 150;

/** The stored layout reconciled against `views`; anything unusable yields the default. */
export function loadLayout(views) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return migrate(raw ? JSON.parse(raw) : null, views);
  } catch {
    return createDefaultLayout(views);
  }
}

let timer = null;

export function saveLayout(layout) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // A full or disabled storage costs the user their arrangement on the next
      // reload, which is not worth interrupting them over.
    }
  }, SAVE_DEBOUNCE_MS);
}

/** Forgets the saved arrangement, so the next `loadLayout` returns the default. */
export function clearLayout() {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above: nothing the user can act on.
  }
}
