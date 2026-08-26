/**
 * The graph header's selection box: which element the keyboard is pointing at,
 * and what pressing a key would do to it.
 *
 * Selection had no visible consequence outside the drawing, so there was nothing
 * to tell the user which node `f` would fold. The box is that, and it doubles as
 * where the shortcut is advertised — a right-click menu cannot mention it.
 *
 * It carries edges too (docs/adr/0019-select-and-swap-edges.md), where it does one
 * more job: `s` swaps a whole predicate at once, not the one arrow that was
 * clicked, and the box is where that blast radius is stated before the key is
 * pressed.
 *
 * `selectionLabel` is kept pure and separate from the DOM for the same reason
 * graphStyle's builders are: the wording is the part worth asserting on.
 */

import { displayIdOf } from '../rdf/graphModel.js';

const NOTHING_SELECTED = 'no selection';

/**
 * What the box reads for an edge selection.
 *
 * The arrow is read off `label` — the predicate as *drawn*, which is the inverse
 * name while the direction is flipped — and the hint off `predicate`, which is
 * always the CURIE as written. That the two differ is the point: `s` acts on the
 * written predicate, so it moves every edge that shares it.
 *
 * Only an invertible predicate advertises `s`, the same way only a container
 * advertises `f`. On the rest, pressing it flashes "has no inverse property" over
 * the drawing, which is where the reason is better told than in a box this size.
 *
 * `label` is taken whole, so a folded edge's `×N` count comes along: it says the
 * arrow stands for more than one written link, which is worth knowing before `g`
 * jumps to a source line.
 */
function edgeLabel(selection) {
  const drawn = selection.label || selection.predicate;
  const arrow = `${displayIdOf(selection.source)} → ${displayIdOf(selection.target)}`;
  const base = `${drawn}: ${arrow}`;
  if (!selection.invertible) return base;
  return `${base} · s: swap all ${selection.predicate}`;
}

/**
 * What the box reads for `selection` — `{ kind, … }` from viz/graphPane.js, or null.
 *
 * Ids are shortened the same way the elements' own labels are, so the box and the
 * drawing agree on what a thing is called.
 */
export function selectionLabel(selection) {
  if (!selection) return NOTHING_SELECTED;
  if (selection.kind === 'edge') return edgeLabel(selection);
  const id = displayIdOf(selection.id);
  const hints = ['>/<: flow'];
  // Only a container has anything for `f` to do, so only a container advertises it.
  if (selection.foldable) hints.unshift(`f: ${selection.folded ? 'unfold' : 'fold'}`);
  return `${id} · ${hints.join(' · ')}`;
}

/**
 * Writes `selection` into `host`, dimmed when there is nothing selected.
 *
 * The box ellipsizes rather than growing the header, so the tooltip repeats the
 * label in full before the id — otherwise a long edge label would hide the very
 * shortcut hint it is there to advertise.
 */
export function renderSelectionBox(host, selection) {
  const text = selectionLabel(selection);
  host.textContent = text;
  host.classList.toggle('is-empty', !selection);
  host.title = selection ? `${text}\n${selection.id}` : NOTHING_SELECTED;
}
