/**
 * Finding a drawn node by name.
 *
 * The graph answers questions about the *selected* element — `f` folds it, `g`
 * jumps to its mermaid line, `>` walks its flow — but until now nothing got you
 * to the selection except finding the node by eye. This is the other half:
 * type part of a name, get the nodes it could be, in the order they are worth
 * offering (docs/adr/0042-find-and-focus-node.md).
 *
 * Pure and cytoscape-free, like viz/pathFocus.js and viz/separateSiblings.js:
 * the suite runs in plain node with no jsdom, so the part worth asserting on is
 * the part that never touches the drawing.
 */

/**
 * The fields a query is matched against, best first.
 *
 * The mermaid id as written and the human label — the two things a reader knows
 * a node by, and the two the drawing shows them. Deliberately a plain list and
 * nothing more: which fields are searched is one decision, and it should stay
 * one line to change rather than a mechanism to configure.
 */
const SEARCH_FIELDS = ['displayId', 'name'];

/**
 * How good a match `record` is for the already-lowercased `needle`, lower being
 * better, or null when it is not a match at all.
 *
 * Prefix hits rank above substring hits across the board, and ties go to the
 * earlier field. Typing `db` should offer the node *called* `db` before the one
 * merely containing those letters in `backup-db-restore`, whichever field each
 * hit came from — that is what makes the first Enter land somewhere the user
 * expected rather than somewhere alphabetical.
 */
function rankOf(record, needle) {
  let best = null;
  SEARCH_FIELDS.forEach((field, priority) => {
    const value = record?.[field];
    if (typeof value !== 'string') return;
    const at = value.toLowerCase().indexOf(needle);
    if (at === -1) return;
    // Two ranks per field, so every prefix hit sorts above every substring hit.
    const rank = (at === 0 ? 0 : SEARCH_FIELDS.length) + priority;
    if (best === null || rank < best) best = rank;
  });
  return best;
}

/**
 * The ids of the nodes matching `query`, best first.
 *
 * `records` are `{ id, displayId, name }` as the pane reads them off the drawing.
 * Matching is case-insensitive substring: a reader looking for a node knows some
 * of its name, not how it is capitalised or where the fragment falls.
 *
 * A blank query matches nothing rather than everything. The caller uses that to
 * mean "no search is running", which is a different state from "searched and
 * found nothing" — the first dims no part of the drawing, the second says so.
 *
 * Each node appears once however many of its fields hit, and equally ranked
 * nodes keep the order they were given, so the list is stable across keystrokes
 * that do not change the ranking.
 */
export function matchNodes(records, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];

  const ranked = [];
  (records ?? []).forEach((record, order) => {
    if (!record?.id) return;
    const rank = rankOf(record, needle);
    if (rank === null) return;
    ranked.push({ id: record.id, rank, order });
  });

  // `order` as the tiebreak rather than relying on sort stability: it is
  // guaranteed by the spec now, but saying it costs one comparison and makes the
  // ordering a property of this function instead of of the engine running it.
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.map((entry) => entry.id);
}
