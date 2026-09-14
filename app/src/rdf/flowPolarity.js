/**
 * Which way the *flow* runs along a link, as opposed to which way the triple was
 * written.
 *
 * A drawing whose arrows follow the predicates zig-zags, because a predicate's
 * subject is not reliably the upstream party. Written as
 *
 *     proxy --d3f:accesses--> resource
 *     app   --d3f:manages---> resource
 *     app   --d3f:produces--> query
 *     db    --d3f:executes--> query
 *
 * a reader sees `proxy → resource → app → query → db`, but two of the four
 * arrows point against that, so `elk-layered` is handed an almost-cyclic graph
 * and lays it out accordingly (docs/adr/0035-improve-flow-discovery.md).
 *
 * This is a fourth axis over the predicates, and the fourth for the same reason
 * the other three are separate. linkKind.js answers which bucket a predicate is
 * in and keys that on the ontology branch it descends from; artifactFlow.js
 * answers where the *payload* sits so a mediated path can be collapsed;
 * predicateEffect.js answers what the link does to the artifact on one of its
 * ends. None of them answers this one, and the proof is a pair they cannot
 * separate: `d3f:reads` and `d3f:executes` are both in artifactFlow.js's
 * CONSUMING_ONTO_OBJECT and both `reading`/`object` to predicateEffect.js, yet
 * they orient oppositely here. So the table below is curation, not derivation —
 * pull-versus-push is not a distinction D3FEND draws.
 *
 * Direction, not role, which is where this axis differs from its two
 * neighbours. Their docstrings both explain that the affected end is not
 * reliably the object, so a role is a pair of (predicate, end). Here the answer
 * *is* an end-to-end direction, because that is what a layout consumes.
 * Computed on the predicate **as written** all the same (rdf/graphModel.js
 * builds the model before any direction state exists), so 'forward' means
 * subject→object and 'reverse' means object→subject.
 *
 * The corpus counts in the comments below are occurrences across
 * docs/external/cad/*.ttl, and they are the evidence each entry rests on. An
 * entry with no count is carried for symmetry with one that has them — the `-by`
 * forms mostly — and is not attested.
 *
 * Every predicate below exists in D3FEND, checked against
 * d3fend-completions.json by flow-polarity.test.js, the same guard
 * link-kind.test.js, artifact-flow.test.js and predicate-effect.test.js put on
 * their tables. That is what keeps the invented display labels of the edge swap
 * — `d3f:read-by`, `d3f:written-by`, `d3f:managed-by`
 * (docs/adr/0019-select-and-swap-edges.md) — out of it: those are names for
 * drawing a link backwards, and a table about which way to draw it cannot be
 * keyed on them.
 */

/**
 * The flow runs subject→object: the subject is the requester, the producer, or
 * the predecessor.
 *
 * `d3f:precedes` [70] leads because it is the most frequent predicate in the CAD
 * corpus and the only pure ordering one — it chains `d3f:Event` and ATT&CK
 * technique nodes into an attack sequence, and is the ordinal
 * docs/adr/0026-collapse-artifact-mediated-paths.md records as missing from the
 * RDF. It is missing for an infrastructure diagram; an attack graph has it.
 *
 * `d3f:has-recipient` [6] is asserted from the *message*, not from the party:
 * `message d3f:has-recipient agent`. So the message precedes the recipient and
 * this is forward, while `d3f:has-sender` below is reverse. The pair is the
 * corpus's message reification and neither half is in any of the other three
 * axes.
 *
 * `d3f:reads` and `d3f:accesses` [22] are here rather than in FLOW_REVERSED
 * because this axis follows the *request*, not the bytes: a reader depends on
 * what it reads, and drawing the reply instead would put every client
 * downstream of its own data store. The data-movement reading is the same table
 * with this family flipped, and is deliberately not shipped
 * (docs/adr/0035-improve-flow-discovery.md).
 */
const FLOW_AS_WRITTEN = new Set([
  'd3f:precedes', // [70]
  'd3f:connects', // [58]
  'd3f:accesses', // [22]
  'd3f:produces', // [12]
  'd3f:has-recipient', // [6]
  'd3f:reads', // [3]
  'd3f:writes', // [2]
  'd3f:uses', // [2]
  'd3f:queries', // [2]
  'd3f:transmits',
  'd3f:adds',
  'd3f:creates',
  'd3f:invokes',
  'd3f:depends-on',
  'd3f:mediates-access-to',
  'd3f:may-access',
  'd3f:may-produce',
]);

/**
 * The flow runs object→subject: the subject is the provider, the server, or the
 * originator.
 *
 * `d3f:executes` [8] is the pull-versus-push line this axis exists to draw. A
 * database executes the query its client produced, so the query reaches the
 * database rather than the other way round — the opposite of `d3f:reads`
 * above, though the ontology files both under `d3f:accesses`.
 *
 * `d3f:has-sender` [2] is the reverse leg of the message pair described above.
 *
 * `d3f:manages` [2] rests on the least evidence in either set: two occurrences,
 * both `OTController d3f:manages <device>`, plus the report this axis came
 * from. Kept because a managed thing is drawn upstream of whatever manages it
 * in every example available, and flagged here so it is the first entry to
 * revisit.
 */
const FLOW_REVERSED = new Set([
  'd3f:executes', // [8]
  'd3f:has-sender', // [2]
  'd3f:manages', // [2]
  'd3f:receives',
  'd3f:decodes',
  'd3f:accessed-by',
  'd3f:executed-by',
  'd3f:used-by',
  'd3f:produced-by',
  'd3f:invoked-by',
  'd3f:preceded-by',
  'd3f:contained-by',
  'd3f:access-mediated-by',
  'd3f:may-be-accessed-by',
  'd3f:may-execute',
]);

/**
 * Deliberately absent, so the reasons are not rediscovered one at a time:
 *
 * - `d3f:runs` [4] — the subject's role is not stable. The corpus writes it
 *   host→process (`ClientComputer d3f:runs <process>`), while
 *   docs/adr/0034-platform-topology-and-location.md writes it process→service.
 *   A predicate used both ways carries no polarity, and guessing one would
 *   reorient half the diagrams wrongly.
 * - `d3f:connected-to` [8] and `d3f:communicates-with` [21] — symmetric, and
 *   their own inverse in inverse-map.json. Topology asserts that a link exists
 *   and never that anything crosses it (docs/adr/0007-classify-graph-links.md).
 * - `d3f:has-participant` [29] and `d3f:has-agent` — a role in an event, not a
 *   position in a sequence. Two participants of one event are not ordered.
 * - `d3f:contains` [33] — reaches the view as a compound parent, never as a
 *   link (rdf/graphModel.js), so it has no arrow to orient. Its inverse
 *   `d3f:contained-by` is above and is now nearly as unreachable: a diagram
 *   writing it emits `d3f:contains` with the ends exchanged (NORMALIZED_INVERSES
 *   in rdf/emit.js). The entry is kept because TriG typed by hand or imported as
 *   a `.ttl` bypasses emit, and such a quad is still drawn as a link.
 * - `d3f:modifies` [17], `d3f:deletes` and the rest of the lifecycle verbs —
 *   they end or alter a payload rather than move it, which is the same
 *   exclusion artifactFlow.js makes and for the same reason.
 * - The tactical verbs. A defensive action is not a step in the flow it acts
 *   on, and ADR 7 already gives that whole bucket its own channel.
 */
export const FLOW_POLARITY_PREDICATES = new Set([...FLOW_AS_WRITTEN, ...FLOW_REVERSED]);

/**
 * Which way the flow runs along a link, or null when the predicate says
 * nothing about flow — which is most of them.
 *
 * Returns 'forward' (subject→object, draw as written), 'reverse'
 * (object→subject, draw the link backwards) or null (leave it alone).
 *
 * A caller that acts on 'reverse' needs an inverse name to relabel with, and
 * inverse-map.json does not cover every predicate. A reverse polarity with no
 * inverse must leave the link as written rather than drop it; viz/toCytoscape.js
 * gets that for free by checking `edge.inverse` before flipping, as the manual
 * swap already does.
 */
export function flowPolarityOf(predicateCurie) {
  if (FLOW_AS_WRITTEN.has(predicateCurie)) return 'forward';
  if (FLOW_REVERSED.has(predicateCurie)) return 'reverse';
  return null;
}

/**
 * The predicates that state an order, which a layout must not reverse when it
 * breaks a cycle.
 *
 * A set of one today. It is a set, and a function rather than the bare CURIE,
 * because the caller is viz/layouts.js by way of the model edge: nothing in the
 * view layer may name a predicate (ADR 0014), so the answer travels as a flag
 * on the edge and this is where the question is asked.
 */
const SEQUENCE_PREDICATES = new Set(['d3f:precedes', 'd3f:preceded-by']);

/** True for a link whose whole content is "this step comes before that one". */
export function isSequencePredicate(predicateCurie) {
  return SEQUENCE_PREDICATES.has(predicateCurie);
}
