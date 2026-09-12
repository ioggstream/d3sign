/**
 * Node-kind buckets for the graph view's Nodes filter, the node-side counterpart
 * to the link kinds in linkKind.js.
 *
 * These group the categories that graphModel.js's `coreCategoryOf` already resolves
 * (and colours by) — the five D3FENDCore branches, plus the DPV families that have no
 * D3FEND counterpart — so a node's bucket agrees with its *category*: a node typed both
 * Agent and Artifact is an Actor in both, and a `dpv:DataController` is an Actor
 * because DPV's Entity family folds onto Agent.
 *
 * One documented exception, and only one: `nodeColor` in viz/graphStyle.js paints an
 * offensive technique red whatever its branch, so colour and bucket disagree there on
 * purpose (an attack stays in the 'tactical' bucket). Nothing else may add a second
 * exception without saying so here — the point of routing both through one function is
 * that the filter and the legend cannot drift apart silently.
 *
 * Note 'tactical' here means the Plan/Goal branches — unrelated to the
 * 'tactical-verb' *link* kind, which classifies predicates. 'location' is the same
 * kind of near-collision and is deliberate rather than accidental: the node bucket
 * holds the places (`d3f:PhysicalLocation`, DPV's Location family) and the link kind
 * of the same name holds the predicates that put something in one
 * (`d3f:has-location`), so they are drawn in one colour and a site reads as one idea.
 */

/** All node kinds a node can be classified into. */
export const NODE_KINDS = ['artifacts', 'actors', 'tactical', 'events', 'legal', 'location', 'other'];

export const NODE_KIND_LABELS = {
  artifacts: 'Artifacts',
  actors: 'Actors',
  tactical: 'Tactical',
  events: 'Events',
  legal: 'Legal',
  location: 'Location',
  other: 'Other',
};

/**
 * `Location` is the one category both vocabularies reach — `coreCategoryOf` maps
 * D3FEND's PhysicalLocation branch and DPV's Location family onto it — so a site
 * filters as a location whichever one typed it.
 *
 * The four DPV-only categories share one bucket rather than getting four of their
 * own: the Nodes filter is a row of checkboxes, and doubling its length to separate
 * a legal basis from a purpose would cost more than it tells anyone. DPV's Entity and
 * Data families never reach here — `coreCategoryOf` folds them onto Agent and
 * Artifact, so a data controller filters as an actor and personal data as an
 * artifact, which is what they are.
 */
const KIND_BY_CORE_CATEGORY = {
  Agent: 'actors',
  Artifact: 'artifacts',
  Plan: 'tactical',
  Goal: 'tactical',
  Event: 'events',
  Measure: 'legal',
  LegalBasis: 'legal',
  Purpose: 'legal',
  Process: 'legal',
  Location: 'location',
};

/**
 * Maps a resolved category to its bucket. Everything outside the recognised ones —
 * the D3FEND branches Weakness, Sensor, Group, Link, Log,
 * Time, Vulnerability and Condition, classes missing from d3fend-categories.json,
 * DPV terms missing from legal-categories.json (which is every one of them until
 * build-legal-metadata.py has been run), and nodes with no class at all — is 'other'.
 */
export function classifyNodeCategory(coreCategory) {
  return KIND_BY_CORE_CATEGORY[coreCategory] ?? 'other';
}
