/**
 * Which end of a data-flow link the *payload* sits on, and whether that link puts
 * the payload into the world or takes it out again.
 *
 * This is what lets the graph view collapse an artifact-mediated path — `A
 * d3f:produces b`, `b d3f:accessed-by C` — into one arrow `A → C` labelled with
 * `b` (docs/adr/0026-collapse-artifact-mediated-paths.md). The classification is
 * *not* the same axis as linkKind.js, which answers which of the LINK_KINDS a
 * predicate is and keys that on which branch of the ontology it descends from.
 * A `d3f:writes` / `d3f:accessed-by` pair is one path with two roles, so mixing
 * the two axes into one table would blur the one thing that file gets right.
 *
 * Role, not direction: the consuming leg is not reliably the `-by` form. Both
 * shapes occur in the examples — `d1 -->|d3f:accessed-by| p1` puts the consumer
 * on the object end (004-data-pipeline.md), `api -->|d3f:executes| request` puts
 * it on the subject end (003-webapp.md) — so a role is a pair of
 * (predicate, which end the payload is on), not a predicate alone.
 *
 * Every predicate here exists in D3FEND, checked against d3fend-completions.json
 * by artifact-flow.test.js. That rules out `d3f:read-by`, `d3f:written-by`,
 * `d3f:decoded-by` and `d3f:transferred-by`, which are display labels the edge
 * swap invents rather than properties (docs/adr/0019-select-and-swap-edges.md),
 * and it is why every entry below is also in linkKind.js's
 * DATA_FLOW_PREDICATES — so a collapse never depends on the `other` link kind
 * being visible.
 */

/** The payload is what the link *creates*: it is the object of these. */
const PRODUCING_ONTO_OBJECT = new Set([
  'd3f:produces',
  'd3f:writes',
  'd3f:adds',
  'd3f:transmits',
  'd3f:may-produce',
]);

/** The payload is what the link creates, written the other way round. */
const PRODUCING_FROM_SUBJECT = new Set(['d3f:produced-by']);

/** The payload is what the link *takes*: it is the object of these. */
const CONSUMING_ONTO_OBJECT = new Set([
  'd3f:accesses',
  'd3f:reads',
  'd3f:executes',
  'd3f:uses',
  'd3f:decodes',
  'd3f:receives',
  'd3f:may-access',
  'd3f:may-execute',
]);

/** The payload is what the link takes, written the other way round. */
const CONSUMING_FROM_SUBJECT = new Set([
  'd3f:accessed-by',
  'd3f:executed-by',
  'd3f:used-by',
  'd3f:may-be-accessed-by',
]);

/**
 * Deliberately absent, so the reasons are not rediscovered one at a time:
 * `d3f:modifies` — a modifier is not the producer of what the consumer reads,
 * so composing it would claim a hop that never happened; `d3f:deletes` and the
 * rest of the lifecycle verbs — they end a payload rather than move it;
 * `d3f:mediates-access-to` / `d3f:access-mediated-by` — access-control topology,
 * where the middle node is the guard and emphatically not the message. Every
 * control-flow and tactical-verb predicate is out for the same reason: nothing
 * traverses them.
 */
export const ARTIFACT_FLOW_PREDICATES = new Set([
  ...PRODUCING_ONTO_OBJECT,
  ...PRODUCING_FROM_SUBJECT,
  ...CONSUMING_ONTO_OBJECT,
  ...CONSUMING_FROM_SUBJECT,
]);

/**
 * The role a predicate gives the artifact on one of its ends, or null when the
 * predicate is not a payload hop at all.
 *
 * Returns `{ role, payloadEnd }`: `role` is 'producing' or 'consuming' —
 * whether the *other* end put the payload there or took it away — and
 * `payloadEnd` is which end of the triple the payload has to be on for that to
 * hold, 'object' or 'subject'.
 *
 * Called on the predicate **as written** (rdf/graphModel.js builds the model
 * before any direction state exists), so the edge-swap gesture cannot change
 * which paths collapse.
 */
export function artifactFlowRoleOf(predicateCurie) {
  if (PRODUCING_ONTO_OBJECT.has(predicateCurie)) return { role: 'producing', payloadEnd: 'object' };
  if (PRODUCING_FROM_SUBJECT.has(predicateCurie)) return { role: 'producing', payloadEnd: 'subject' };
  if (CONSUMING_ONTO_OBJECT.has(predicateCurie)) return { role: 'consuming', payloadEnd: 'object' };
  if (CONSUMING_FROM_SUBJECT.has(predicateCurie)) return { role: 'consuming', payloadEnd: 'subject' };
  return null;
}
