/**
 * What a link does to the artifact on one of its ends: reads it, changes it, or
 * neither.
 *
 * A second axis over linkKind.js, not a sixth entry in it. The two cut across
 * each other: `classifyPredicate` files `d3f:writes` and `d3f:adds` under
 * `data-flow` and `d3f:deletes` and `d3f:updates` under `tactical-verb`, so no
 * bucket means "this one changes the artifact" and none could be widened into
 * one. The drawing says the kind with colour
 * (docs/adr/0007-classify-graph-links.md) and says this with arrow shape
 * (docs/adr/0033-link-terminators-by-effect.md); an edge says both at once.
 *
 * Nor is it artifactFlow.js's axis, whose tables look almost like these. That
 * one answers where the *payload* sits so an artifact-mediated path can be
 * collapsed (ADR 26), which is why it excludes `d3f:modifies` — "a modifier is
 * not the producer of what the consumer reads" — and the whole lifecycle family.
 * Those exclusions are exactly wrong here: `d3f:modifies` and `d3f:deletes` are
 * the clearest changes a link can make. Its structure is worth copying and its
 * table is not, so the two stay separate, as its own docstring asks.
 *
 * Role, not direction, for the same reason artifactFlow.js gives: the affected
 * end is not reliably the object. `d1 -->|d3f:accessed-by| p1` reads `d1`, the
 * subject; `p1 -->|d3f:reads| d1` reads `d1`, the object. So an effect is a pair
 * of (predicate, which end it lands on).
 *
 * Every predicate below exists in D3FEND, checked against
 * d3fend-completions.json by predicate-effect.test.js — the same guard
 * link-kind.test.js and artifact-flow.test.js put on their tables, and for the
 * same reason: a name that reads as though it must exist is not evidence that it
 * does. That is what rules out `d3f:read-by`, `d3f:written-by` and
 * `d3f:received-by`, which the edge swap invents as display labels rather than
 * finding as properties (docs/adr/0019-select-and-swap-edges.md).
 */

/**
 * The object is what gets changed.
 *
 * The ontology draws most of this line itself: `d3fend:modifies` is a
 * subproperty of `d3fend:accesses` and heads five children — `deletes`,
 * `disables`, `extends`, `obfuscates`, `updates` — with `d3fend:writes` its
 * sibling under `accesses`. The rest bring their object into existence rather
 * than alter it, and hang off `associated-with` instead, so they are curated in
 * and named here as the exceptions they are: `adds`, `creates`, `produces` and
 * `transmits`.
 *
 * Deliberately absent: the tactical verbs that change something without
 * descending from `d3fend:modifies` — `blocks`, `evicts`, `terminates`,
 * `isolates`, `suspends` and the rest. Some 25 of the 35 predicates in
 * linkKind.js's `TACTICAL_VERB_PREDICATES` would qualify on a plain reading of
 * "changes something", which would make this axis a near-copy of the green ADR 7
 * already gives that whole bucket — two channels saying one thing. The four that
 * *are* under `d3fend:modifies` (`deletes`, `updates`, `disables`,
 * `obfuscates`) are in, and are both green and triangle-headed: green says the
 * link is a defensive action, the head says the artifact changes. Both hold.
 */
const WRITING_ONTO_OBJECT = new Set([
  'd3f:modifies',
  'd3f:deletes',
  'd3f:disables',
  'd3f:extends',
  'd3f:obfuscates',
  'd3f:updates',
  'd3f:writes',
  'd3f:adds',
  'd3f:creates',
  'd3f:produces',
  'd3f:transmits',
  'd3f:may-modify',
  'd3f:may-add',
  'd3f:may-create',
  'd3f:may-produce',
]);

/** The same, written the other way round: the subject is what gets changed. */
const WRITING_FROM_SUBJECT = new Set(['d3f:modified-by', 'd3f:created-by', 'd3f:produced-by']);

/**
 * The object is what gets read.
 *
 * The `d3fend:accesses` branch minus the writing half: `accesses` itself, which
 * ADR 7 glosses as "an active action (e.g., reading a file)", `reads` with its
 * child `enumerates`, and the `executes` subtree — running an artifact consumes
 * it, which is the reading artifactFlow.js's `CONSUMING_ONTO_OBJECT` already
 * makes of `d3f:executes`. `d3f:injects` is left out of that subtree on purpose:
 * it is the one child of `executes` that puts something *into* its object, and
 * classing it as a read would draw the opposite of what it does.
 *
 * Then the consumption verbs from elsewhere in the hierarchy — `uses`,
 * `decodes`, `receives` (the counterpart of `transmits` above) and `queries`.
 * `d3f:queries` is `control-flow` to linkKind.js, which is the point of keeping
 * the axes apart: a query is a control-flow link that reads.
 *
 * Tactical verbs that read — `monitors`, `analyzes`, `detects` — are out, for
 * symmetry with the writing table above and for the same reason.
 */
const READING_ONTO_OBJECT = new Set([
  // 'd3f:accesses',
  'd3f:reads',
  'd3f:enumerates',
  'd3f:executes',
  'd3f:interprets',
  'd3f:invokes',
  // 'd3f:uses',
  'd3f:decodes',
  'd3f:receives',
  'd3f:queries',
  // 'd3f:may-access',
  'd3f:may-execute',
]);

/** The same, written the other way round: the subject is what gets read. */
const READING_FROM_SUBJECT = new Set([
  'd3f:accessed-by',
  'd3f:executed-by',
  'd3f:invoked-by',
  // 'd3f:used-by',
  'd3f:may-be-accessed-by',
]);

/** Every predicate this axis has an opinion about, for the tests to walk. */
export const EFFECT_PREDICATES = new Set([
  ...WRITING_ONTO_OBJECT,
  ...WRITING_FROM_SUBJECT,
  ...READING_ONTO_OBJECT,
  ...READING_FROM_SUBJECT,
]);

/**
 * What the link does and to which of its ends, or null when it does neither —
 * which is most predicates: topology, containment, the tactical verbs and
 * everything in `other`.
 *
 * Returns `{ effect, affectedEnd }`: `effect` is 'reading' or 'writing', and
 * `affectedEnd` is which end of the triple it lands on, 'object' or 'subject'.
 *
 * Called on the predicate **as written** (rdf/graphModel.js builds the model
 * before any direction state exists), so a view that draws the link backwards
 * has to exchange the ends itself — which takes no vocabulary, and is what keeps
 * viz/toCytoscape.js free of imports from this layer (ADR 0014).
 */
export function predicateEffectOf(predicateCurie) {
  if (WRITING_ONTO_OBJECT.has(predicateCurie)) return { effect: 'writing', affectedEnd: 'object' };
  if (WRITING_FROM_SUBJECT.has(predicateCurie)) return { effect: 'writing', affectedEnd: 'subject' };
  if (READING_ONTO_OBJECT.has(predicateCurie)) return { effect: 'reading', affectedEnd: 'object' };
  if (READING_FROM_SUBJECT.has(predicateCurie)) return { effect: 'reading', affectedEnd: 'subject' };
  return null;
}
