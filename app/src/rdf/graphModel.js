/**
 * Derives the graph view's model from RDF alone: quads in, nodes/edges/containment
 * out. This is step 2 of the pipeline
 *
 *   1. mermaid → trig   (parser/ + rdf/emit.js)
 *   2. trig → view      (this module + viz/toCytoscape.js)
 *
 * so nothing downstream of the store knows that mermaid exists. Any quads in the
 * store render — hand-written turtle, enrichment graphs, a direct RDF import —
 * not just the ones a diagram produced.
 *
 * Every triple is one of four things:
 *   - a literal-valued statement  → a node attribute (rdfs:label is the display one)
 *   - rdf:type                    → the node's classes, which drive colour and node kind
 *   - a containment predicate     → a compound (container) parent/child relation
 *   - anything else with an IRI/blank object → an edge
 */
import { PREFIXES, PROVENANCE, curieWith, inversePredicateOf } from './emit.js';
import { artifactFlowRoleOf } from './artifactFlow.js';
import { flowPolarityOf, isSequencePredicate } from './flowPolarity.js';
import { classifyPredicate } from './linkKind.js';
import { predicateEffectOf } from './predicateEffect.js';
import { classifyNodeCategory } from './nodeKind.js';
import d3fendCategories from '../data/d3fend-categories.json';
import d3fendMetadata from '../data/d3fend-metadata.json';
import legalCategories from '../data/legal-categories.json';

const RDF_TYPE = PREFIXES.rdf + 'type';
const RDFS_LABEL = PREFIXES.rdfs + 'label';

/**
 * Predicates read as containment, rendering the object inside the subject as a
 * compound node (see docs/adr/0012-fold-container-nodes.md). They are structure,
 * so they are never also drawn as an edge.
 */
export const CONTAINMENT_PREDICATES = new Set([PREFIXES.d3f + 'contains']);

/**
 * Predicates that group a resource into the instance it belongs to, stated from
 * the member's side (`ws-1-nic ds:partOf ws-1`) rather than the container's.
 *
 * Read as structure for the same reason containment is: an instance of an
 * architecture template is drawn as one collapsible box
 * (docs/adr/0031-architecture-templates.md), and a membership statement left to
 * the edge branch below would instead draw one link per member plus an entry in
 * the Links filter — the drawing the box exists to replace. Kept apart from
 * CONTAINMENT_PREDICATES because the direction is the other way round, which is
 * also why containment is tested first: where both could place a member,
 * containment is the ontological claim and wins the parent.
 */
export const MEMBERSHIP_PREDICATES = new Set([PROVENANCE.partOf]);

/**
 * Provenance that is bookkeeping about the document rather than a fact in it:
 * `ws-1 ds:instantiates T:HostTemplate` names a *block*, so drawing it would put
 * a template in the graph as though it were a resource. Skipped outright — no
 * node for the object, no edge.
 */
const HIDDEN_PREDICATES = new Set([PROVENANCE.instantiates]);

const CORE_CATEGORY_PRIORITY = ['Agent', 'Goal', 'Plan', 'Artifact', 'Event', 'PhysicalLocation'];

/**
 * D3FEND branch name → core category, for the branches whose category is not simply
 * their own name. Only one entry: `d3f:PhysicalLocation` and DPV's Location family
 * are the same thing to a reader, so they share the category `Location` and with it
 * one colour and one Nodes bucket. Calling it `PhysicalLocation` would read as a
 * contradiction on a `dpv:CloudLocation` node, which is a location and not physical.
 *
 * PhysicalLocation is last in the priority list: it is a place, and a node that is
 * also an Artifact or an Agent is better drawn as the thing than as where it sits.
 * The class has no subclasses in D3FEND (d3f:PhysicalLocation is a direct child of
 * d3f:D3FENDCore), so the rank decides nothing today.
 */
const CATEGORY_BY_D3FEND_BRANCH = {
  PhysicalLocation: 'Location',
};

/**
 * This app's own namespaces, as opposed to the vocabularies: the document
 * (`G:`), the enrichment graphs (`E:`) and the minted neighbourhoods (`N:`).
 * Longest first, because both of the others start with `G:` — see `displayIdOf`.
 */
const LOCAL_BASES = [PREFIXES.E, PREFIXES.N, PREFIXES.G];

/**
 * The vocabulary namespaces, i.e. PREFIXES minus this app's own. Splitting them
 * out keeps `shortLabel` from turning `urn:d3fend-graph:host` into `G:host`: a
 * graph-local resource is named by the bare id the diagram gave it (see
 * `displayIdOf`), and the properties table prints it the same way.
 */
const VOCABULARY_PREFIXES = Object.fromEntries(
  Object.entries(PREFIXES).filter(([, base]) => !LOCAL_BASES.includes(base)),
);

/**
 * Renders an IRI as a CURIE when it sits under a known vocabulary prefix, else
 * unchanged.
 *
 * Built from PREFIXES rather than testing `d3f:`/`rdf:`/`rdfs:` by hand, so a node
 * typed in a vocabulary added to that map is not labelled with a raw URL. It used to
 * be: a `dpv:`-typed node's `rdfType` came out as the whole
 * `https://w3id.org/dpv#PersonalData`, which then became a line of the node's label
 * in the drawing and was handed to `resolveIconName` as if it were an icon name.
 */
export function shortLabel(iri) {
  return curieWith(iri, VOCABULARY_PREFIXES);
}

/**
 * The identifier shown on a node: the bare local name for graph-local resources
 * (`urn:d3fend-graph:dev-pk` → `dev-pk`, which is what the diagram called it),
 * a CURIE for everything else.
 */
export function displayIdOf(iri) {
  for (const base of LOCAL_BASES) {
    if (iri.startsWith(base)) return iri.slice(base.length);
  }
  return shortLabel(iri);
}

/**
 * Where a DPV family lands among the categories the view already draws.
 *
 * Entity and Data are *the same concepts in another vocabulary* — which is what the
 * alignment in regulation.ttl asserts — so they take the colour and bucket D3FEND
 * gives them rather than inventing a second orange and a second blue. That also
 * keeps nodeKind.js's invariant intact for free: a node's bucket agrees with its
 * colour because both are decided here.
 *
 * The remaining families have no D3FEND counterpart and get their own colour and
 * their own bucket (see CATEGORY_COLORS in viz/graphStyle.js, KIND_BY_CORE_CATEGORY
 * in nodeKind.js).
 */
const CATEGORY_BY_DPV_FAMILY = {
  Entity: 'Agent',
  Data: 'Artifact',
  Measure: 'Measure',
  LegalBasis: 'LegalBasis',
  Purpose: 'Purpose',
  Process: 'Process',
  // Folds onto the same category as d3f:PhysicalLocation rather than getting a
  // second colour, exactly as Entity and Data fold onto Agent and Artifact: a place
  // is a place whichever vocabulary named it.
  Location: 'Location',
};

/**
 * Highest-priority category among a node's classes: a D3FENDCore top-level branch
 * (Agent > Goal > Plan > Artifact > Event > PhysicalLocation) per
 * d3fend-categories.json, or the category a DPV family maps to per
 * legal-categories.json. A branch whose category is not its own name is remapped
 * through CATEGORY_BY_D3FEND_BRANCH.
 *
 * Event and PhysicalLocation come last only for tidiness: no class in
 * d3fend-categories.json reaches either branch and another one, so their rank never
 * decides anything today.
 *
 * Null for a node whose classes fall outside both tables (e.g. d3f:Vulnerability,
 * d3f:Weakness, an unprojected DPV term) — those keep the default node style.
 *
 * D3FEND wins on a node carrying both, since a `d3f:` class says more about how to
 * draw a box than `dpv:PersonalData` does; the DPV type still shows in the panel and
 * in the node's type line.
 */
function coreCategoryOf(typeIris) {
  const branches = new Set();
  for (const iri of typeIris) {
    if (!iri.startsWith(PREFIXES.d3f)) continue;
    for (const branch of d3fendCategories[iri.slice(PREFIXES.d3f.length)] || []) branches.add(branch);
  }
  const d3fendBranch = CORE_CATEGORY_PRIORITY.find((branch) => branches.has(branch));
  if (d3fendBranch) return CATEGORY_BY_D3FEND_BRANCH[d3fendBranch] ?? d3fendBranch;

  for (const iri of typeIris) {
    const family = legalCategories[shortLabel(iri)];
    if (family) return CATEGORY_BY_DPV_FAMILY[family] ?? null;
  }
  return null;
}

/**
 * The predicate that says a thing is *not* somewhere. It is a location link and
 * classifies as one, so it is coloured and filtered with the others — but reading it
 * as a place would put a confident wrong answer on a node, which is worse than the
 * blank it replaces (docs/adr/0036-location-pins.md).
 */
const NEGATED_LOCATION_PREDICATE = 'dpv:isOutsideOfLocation';

/**
 * Each node's own location target, from the edges that state one.
 *
 * Keyed on the edge's `kind` rather than on the predicate, so this stays one more
 * consumer of the classification in rdf/linkKind.js instead of a second list of
 * names to keep in step. The one predicate named outright is the negated one, and
 * it is named here rather than in the view: `viz/` may not know a vocabulary.
 *
 * First edge wins, like `parentOf` does. A node stating two places is drawing
 * something this reading cannot express, and picking one is better than picking
 * both.
 */
function locationEdgeTargets(edges) {
  const targets = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'location') continue;
    if (edge.predicate === NEGATED_LOCATION_PREDICATE) continue;
    if (!targets.has(edge.from)) targets.set(edge.from, edge.to);
  }
  return targets;
}

/**
 * Where a node sits — the place it names, or the place it is in.
 *
 * A diagram states location two ways: an explicit `d3f:has-location` edge, or
 * nesting inside a container that *is* a place. Both mean the same thing to a
 * reader, so both resolve here to the same word, drawn on the node itself
 * (`drawnLabel` in viz/graphPrefs.js). See docs/adr/0036-location-pins.md.
 *
 * One walk, starting at the node and climbing `parentOf`:
 *
 * 1. the place this node's own location edge names, at every hop — which is what
 *    makes a host inherit the place its rack stated;
 * 2. failing that, an *ancestor* that is itself a place.
 *
 * Step 2 is skipped for the node itself, because a place is not located in itself.
 * The test is `coreCategory === 'Location'`, which covers `d3f:PhysicalLocation` and
 * DPV's Location family without naming either.
 *
 * Returns `{ label, iri, conflict }`. `iri` is set **only** when the location came
 * from an edge on the node itself: that is the edge the view may absorb, and an
 * inherited location has none. Null for a node with no location at all, which is a
 * correct answer — a logical service has no place, only its deployments do.
 *
 * `conflict` is the second thing the walk is for. A node that names its own place is
 * still drawn inside whatever contains it, because containment wins the parent
 * (docs/adr/0036-location-pins.md). If the thing containing it is
 * somewhere else, the drawing is asserting two places for one component, and only the
 * author can say which statement is wrong — so the walk carries on past the node's
 * own answer, and reports the first ancestor that disagrees.
 *
 * Two limits, neither fixed here. `parentOf` is first-parent-wins ("cytoscape
 * compound nodes are a tree, not a DAG"), so a node contained by both a rack and a
 * site reports whichever quad the store returned first. And containment is resolved
 * within the union of the visible graphs, so a platform split across diagrams
 * reports a location only where the nesting is drawn.
 */
function locationOf(iri, nodes, parentOf, locationTargets) {
  const nameOf = (node) => node && (node.label || node.id);
  const seen = new Set(); // a hand-drawn d3f:contains loop must terminate
  let found = null; // the node's own answer, kept while the walk looks for a clash
  let current = iri;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    // A place this hop names, or — for an ancestor only — the hop being one itself.
    // A place is not located in itself, which is why the second half skips `iri`.
    const stated = locationTargets.get(current);
    const place = stated ? nodes.get(stated) : null;
    const here =
      (place && { value: stated, label: nameOf(place) }) ||
      (current !== iri && node?.coreCategory === 'Location'
        ? { value: current, label: nameOf(node) }
        : null);

    if (here?.label) {
      // The IRI only when the node itself stated it — `a-h1` inheriting `:a`'s
      // place has no edge of its own for the view to absorb.
      if (!found) found = { label: here.label, iri: current === iri ? stated : null };
      else if (here.value !== found.place) {
        return { ...found, conflict: { container: current, place: here.label } };
      }
      if (!found.place) found.place = here.value;
    }
    current = parentOf.get(current);
  }
  return found;
}

/**
 * True when any of a node's d3f: classes is an offensive technique, per the
 * `offensive` flag `build-d3fend-metadata.py` writes (the d3f:OffensiveTechnique
 * closure plus everything carrying a `d3f:attack-id`).
 *
 * It is deliberately not a fifth `coreCategory`: an ATT&CK technique's branch is
 * `Plan`, the same as a countermeasure's, and that is what puts it in the Tactical
 * bucket of the Nodes filter. This is a second, orthogonal fact about the node —
 * "the plan is the adversary's" — and only the colour reads it.
 */
function isOffensive(typeIris) {
  return typeIris.some(
    (iri) =>
      iri.startsWith(PREFIXES.d3f) && d3fendMetadata[iri.slice(PREFIXES.d3f.length)]?.offensive === true,
  );
}

/** True for terms that denote a graph node (IRIs and blank nodes, not literals). */
function isResource(term) {
  return term.termType === 'NamedNode' || term.termType === 'BlankNode';
}

/**
 * Builds the view model from every quad in `store` (i.e. the union of the
 * currently visible named graphs, since hidden ones are emptied by
 * `GraphStore.replaceGraph`).
 *
 * Returns `{ nodes, edges, containment, parentOf }`:
 * - `nodes`: Map of IRI → `{ iri, id, label, rdfType, coreCategory, nodeKind, offensive }`
 * - `edges`: `{ from, to, predicate, kind, inverse, flowRole, effectRole }`, IRIs on both
 *   ends, predicate as a CURIE — one entry per quad, so a relation asserted in
 *   two visible graphs is two (parallel) edges, as it is in the store.
 * - `containment` / `parentOf`: the compound-node structure, both directions.
 */
export function buildGraphModel(store) {
  const nodes = new Map();
  const edges = [];
  const containment = new Map();
  const parentOf = new Map();
  const memberships = [];

  const nodeFor = (iri) => {
    let node = nodes.get(iri);
    if (!node) {
      node = { iri, id: displayIdOf(iri), label: '', types: [], rdfType: null };
      nodes.set(iri, node);
    }
    return node;
  };

  for (const quad of store.getQuads()) {
    if (!isResource(quad.subject)) continue;
    const subject = nodeFor(quad.subject.value);
    const predicate = quad.predicate.value;

    if (quad.object.termType === 'Literal') {
      // Literals never create nodes; only the label is needed for display, the
      // rest stay in the store for the node panel to show.
      if (predicate === RDFS_LABEL && !subject.label) subject.label = quad.object.value;
      continue;
    }
    if (!isResource(quad.object)) continue;

    if (predicate === RDF_TYPE) {
      subject.types.push(quad.object.value);
      continue;
    }

    if (HIDDEN_PREDICATES.has(predicate)) continue;

    if (MEMBERSHIP_PREDICATES.has(predicate)) {
      // Held back rather than applied here: containment has to win the parent
      // wherever both could place a member, and the quads arrive in whatever
      // order the store returns them.
      nodeFor(quad.object.value);
      if (quad.object.value !== subject.iri) {
        memberships.push({ container: quad.object.value, child: subject.iri });
      }
      continue;
    }

    if (CONTAINMENT_PREDICATES.has(predicate)) {
      // A resource contained in itself would make it its own cytoscape parent.
      if (quad.object.value === subject.iri) continue;
      nodeFor(quad.object.value);
      const children = containment.get(subject.iri) || [];
      if (!children.includes(quad.object.value)) children.push(quad.object.value);
      containment.set(subject.iri, children);
      // First parent wins: cytoscape compound nodes are a tree, not a DAG.
      if (!parentOf.has(quad.object.value)) parentOf.set(quad.object.value, subject.iri);
      continue;
    }

    nodeFor(quad.object.value);
    const curie = shortLabel(predicate);
    edges.push({
      from: subject.iri,
      to: quad.object.value,
      predicate: curie,
      kind: classifyPredicate(curie),
      inverse: inversePredicateOf(curie),
      // Resolved here rather than in the view, so the collapse of an
      // artifact-mediated path keys on the predicate *as written*: this runs
      // before any direction state exists, so swapping a predicate for its
      // inverse cannot change which paths collapse. It is also what keeps
      // viz/toCytoscape.js free of imports from this layer (ADR 0014).
      flowRole: artifactFlowRoleOf(curie),
      // Whether the link reads or changes an end, and which end, in the
      // orientation the predicate was written in (rdf/predicateEffect.js).
      // Resolved here for the same reason as the two above — it is a fact about
      // the vocabulary, and the view is not allowed to know the vocabulary. The
      // view *is* allowed to know that drawing a link backwards exchanges its
      // ends, which is the one adjustment it makes.
      effectRole: predicateEffectOf(curie),
      // Which way the flow runs along the link, as against which way the triple
      // was written (rdf/flowPolarity.js). Resolved here for the same reason as
      // the three above, and it has to be: the view turns it into a *default*
      // for the direction map, so it must be a fact about the predicate as
      // written or a swapped predicate would keep re-deriving its own default.
      flowPolarity: flowPolarityOf(curie),
      // Whether the link's whole content is an ordering, which the layout must
      // not reverse to break a cycle. Resolved here rather than read off the
      // predicate in viz/layouts.js, so the geometry stays free of vocabulary.
      sequence: isSequencePredicate(curie),
    });
  }

  // Membership groups only what containment has not already placed, so an
  // instance's own container structure survives being grouped into the instance.
  for (const { container, child } of memberships) {
    if (parentOf.has(child)) continue;
    const children = containment.get(container) || [];
    if (!children.includes(child)) children.push(child);
    containment.set(container, children);
    parentOf.set(child, container);
  }

  // Classes are only complete once every quad has been seen.
  for (const node of nodes.values()) {
    node.rdfType = node.types.length ? shortLabel(node.types[0]) : null;
    node.coreCategory = coreCategoryOf(node.types);
    node.nodeKind = classifyNodeCategory(node.coreCategory);
    node.offensive = isOffensive(node.types);
  }

  // A second pass, because the walk reads the `coreCategory` the first one assigns.
  const locationTargets = locationEdgeTargets(edges);
  const warnings = [];
  for (const node of nodes.values()) {
    const location = locationOf(node.iri, nodes, parentOf, locationTargets);
    if (!location) continue;
    node.location = location.label;
    // Only when the node stated it itself: this is the edge the view may absorb.
    if (location.iri) node.locationIri = location.iri;
    if (!location.conflict) continue;
    // Both sides named, because either statement could be the wrong one and this
    // cannot tell (docs/adr/0036-location-pins.md).
    const container = nodes.get(location.conflict.container);
    warnings.push(
      `"${node.label || node.id}" is in "${location.label}", but "${container?.label || container?.id}" ` +
        `around it is in "${location.conflict.place}". One of the two is wrong.`,
    );
  }

  return { nodes, edges, containment, parentOf, warnings };
}

/** The distinct predicate CURIEs a model's edges use, for the Links filter. */
export function modelPredicates(model) {
  return [...new Set(model.edges.map((e) => e.predicate))];
}
