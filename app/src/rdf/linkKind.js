const DATA_FLOW_PREDICATES = new Set([
  // d3f:accesses is an active action (e.g., reading a file)
  'd3f:accesses',
  'd3f:accessed-by',
  'd3f:executes', // It's a data flow because it inherits from d3f:accesses
  'd3f:executed-by',
  'd3f:writes',
  'd3f:reads',
  // 'd3f:deletes', // Not sure d3f:delete is a data flow, since it doesn't transfer data, but it does transfer control over the data.
  'd3f:adds',
  'd3f:produces',
  'd3f:produced-by',
  // Receiving and trasmitting into a channel.
  'd3f:receives',
  'd3f:transmits',
  'd3f:may-produce',
  'd3f:may-be-produced-by',
  'd3f:may-access',
  'd3f:may-be-accessed-by',
  'd3f:may-execute',
  'd3f:may-be-executed-by',
  'd3f:modifies',
  'd3f:decodes',
  'd3f:uses',
  'd3f:used-by',
  'd3f:mediates-access-to',
  'd3f:access-mediated-by',
]);

const CONTROL_FLOW_PREDICATES = new Set([
  'd3f:controls',
  'd3f:runs',
  'd3f:may-run',
  'd3f:initiates',
  'd3f:initiated-by',
  'd3f:manages',
  'd3f:managed-by',
]);

// Topology, not flow. d3f:connected-to asserts that a direct physical or logical
// link exists — "communication is possible between them without intermediate
// routing" — never that anything traverses it. It is a direct subproperty of
// d3f:associated-with, sibling of both d3f:accesses (data flow) and d3f:controls
// (control flow), so it belongs to neither.
// Deliberately excludes d3f:connects, which despite its name is not a networking
// predicate: "x joins system y by means of communication equipment", used in the
// ontology only by d3f:T1200 (Hardware Additions) and d3f:ConnectSocket.
const CONNECTIVITY_PREDICATES = new Set(['d3f:connected-to']);

// Descendants of d3f:d3fend-tactical-verb-property in the ontology. The sets
// above are disjoint from this one: a predicate is classified by which branch
// of the ontology it descends from, so no predicate needs arbitration.
const TACTICAL_VERB_PREDICATES = new Set([
  'd3f:authenticates',
  'd3f:authenticated-by',
  'd3f:authorizes',
  'd3f:analyzes',
  'd3f:analyzed-by',
  'd3f:blocks',
  'd3f:configures',
  'd3f:deceives-with',
  'd3f:deletes',
  'd3f:detects',
  'd3f:disables',
  'd3f:encrypts',
  'd3f:evicts',
  'd3f:filters',
  'd3f:hardens',
  'd3f:isolates',
  'd3f:limits',
  'd3f:monitors',
  'd3f:neutralizes',
  'd3f:obfuscates',
  'd3f:regenerates',
  'd3f:restricts',
  'd3f:restricted-by',
  'd3f:restores', // rpolli: cowardly added to the tactical-verbs.
  'd3f:signed-by',
  'd3f:signs',
  'd3f:spoofs',
  'd3f:strengthens',
  'd3f:suspends',
  'd3f:terminates',
  'd3f:unloads',
  'd3f:updates',
  'd3f:use-limits',
  'd3f:validated-by',
  'd3f:validates',
  'd3f:verifies',
]);

// DPV's relational vocabulary — who the data is about, who receives it, on what legal
// basis, for what purpose. Deliberately *not* in DATA_FLOW_PREDICATES: these assert
// what a node is associated with, never that anything traverses the link, so they must
// not feed the artifact-path collapse (docs/adr/0026-collapse-artifact-mediated-paths.md)
// which reads a producing link in and a consuming link out as a message.
//
// All `dpv:`, because a diagram can only write the typing vocabularies
// (TYPING_PREFIXES in emit.js). `tech:hasInputData`/`tech:hasOutputData` would be data
// flow, but `tech:` is not one of them, so they cannot appear here.
//
// DPV declares no inverses for any of these, so inverse-map.json has nothing to say
// about them and the swap-direction key is inert on a privacy link. That is honest:
// inventing `dpv:personal-data-of` would put a predicate in the UI that no vocabulary
// defines, which is the complaint already standing against the d3f:read-by family.
// Every one of these is a real DPV property, checked against legal-completions.json by
// link-kind.test.js — the same guard artifact-flow.test.js puts on its D3FEND set, and
// for the same reason: `dpv:hasPersonalDataCategory` reads as though it must exist and
// does not. A personal-data category is a *subclass* of dpv:PersonalData (pd:), so it
// is a type on the node, not a predicate on an edge.
export const PRIVACY_PREDICATES = new Set([
  'dpv:hasPersonalData',
  'dpv:hasDataSubject',
  'dpv:hasDataController',
  'dpv:hasDataProcessor',
  'dpv:hasRecipient',
  'dpv:hasLegalBasis',
  'dpv:hasPurpose',
]);

/** All link kinds a predicate can be classified into, per docs/adr/0007-classify-graph-links.md. */
export const LINK_KINDS = [
  'data-flow',
  'control-flow',
  'connectivity',
  'tactical-verb',
  'privacy',
  'other',
];

/** Classifies a predicate curie into one of LINK_KINDS, per docs/adr/0007-classify-graph-links.md. */
export function classifyPredicate(predicateCurie) {
  if (DATA_FLOW_PREDICATES.has(predicateCurie)) return 'data-flow';
  if (CONTROL_FLOW_PREDICATES.has(predicateCurie)) return 'control-flow';
  if (CONNECTIVITY_PREDICATES.has(predicateCurie)) return 'connectivity';
  if (TACTICAL_VERB_PREDICATES.has(predicateCurie)) return 'tactical-verb';
  if (PRIVACY_PREDICATES.has(predicateCurie)) return 'privacy';
  return 'other';
}
