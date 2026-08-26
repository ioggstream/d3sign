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
import { PREFIXES, curieWith, inversePredicateOf } from './emit.js';
import { artifactFlowRoleOf } from './artifactFlow.js';
import { classifyPredicate } from './linkKind.js';
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

const CORE_CATEGORY_PRIORITY = ['Agent', 'Goal', 'Plan', 'Artifact'];

/**
 * The vocabulary namespaces, i.e. PREFIXES minus this app's own two. Splitting them
 * out keeps `shortLabel` from turning `urn:d3fend-graph:host` into `G:host`: a
 * graph-local resource is named by the bare id the diagram gave it (see
 * `displayIdOf`), and the properties table prints it the same way.
 */
const VOCABULARY_PREFIXES = Object.fromEntries(
  Object.entries(PREFIXES).filter(([prefix]) => prefix !== 'G' && prefix !== 'E'),
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
  for (const base of [PREFIXES.E, PREFIXES.G]) {
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
};

/**
 * Highest-priority category among a node's classes: a D3FENDCore top-level branch
 * (Agent > Goal > Plan > Artifact) per d3fend-categories.json, or the category a
 * DPV family maps to per legal-categories.json.
 *
 * Null for a node whose classes fall outside both tables (e.g. d3f:Vulnerability,
 * d3f:Event, an unprojected DPV term) — those keep the default node style.
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
  if (d3fendBranch) return d3fendBranch;

  for (const iri of typeIris) {
    const family = legalCategories[shortLabel(iri)];
    if (family) return CATEGORY_BY_DPV_FAMILY[family] ?? null;
  }
  return null;
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
 * - `edges`: `{ from, to, predicate, kind, inverse, flowRole }`, IRIs on both
 *   ends, predicate as a CURIE — one entry per quad, so a relation asserted in
 *   two visible graphs is two (parallel) edges, as it is in the store.
 * - `containment` / `parentOf`: the compound-node structure, both directions.
 */
export function buildGraphModel(store) {
  const nodes = new Map();
  const edges = [];
  const containment = new Map();
  const parentOf = new Map();

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
    });
  }

  // Classes are only complete once every quad has been seen.
  for (const node of nodes.values()) {
    node.rdfType = node.types.length ? shortLabel(node.types[0]) : null;
    node.coreCategory = coreCategoryOf(node.types);
    node.nodeKind = classifyNodeCategory(node.coreCategory);
    node.offensive = isOffensive(node.types);
  }

  return { nodes, edges, containment, parentOf };
}

/** The distinct predicate CURIEs a model's edges use, for the Links filter. */
export function modelPredicates(model) {
  return [...new Set(model.edges.map((e) => e.predicate))];
}
