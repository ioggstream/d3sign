/**
 * A node's D3FEND *neighbourhood*, as quads in a named graph the user names.
 *
 * A neighbour of a class is a class linked to it by a d3fend object property, in
 * either direction, that shares a root with it — a direct child of
 * `d3f:D3FENDCore`. That branch restriction is the whole idea: query 01 crosses
 * branches on purpose, because an Artifact reaching the Plan branch *is* a
 * defensive measure, and this deliberately refuses to. What is left is the peer
 * set — for `d3f:File`, Email/Directory/FileSystem/FileHash, not ContentFiltering.
 *
 * It is computed from the two precomputed projections rather than from SPARQL, so
 * the panel can offer it without loading a 3.6 MB ontology first:
 *
 *   - d3fend-metadata.json carries each class's relations, already including the
 *     ones D3FEND states as OWL restrictions (build-d3fend-metadata.py), which is
 *     what the query engine has to materialize at load time to see;
 *   - d3fend-categories.json carries each class's top branches, which is the
 *     `?class rdfs:subClassOf* ?root . ?root rdfs:subClassOf d3f:D3FENDCore`
 *     half of the query, precomputed.
 *
 * Relations come from the node's own class only, not from its superclasses:
 * `d3f:Password` yields the two the ontology states about Password, not
 * everything it inherits from Credential. That matches the query this is a
 * projection of, which walks `subClassOf*` for the branch root and not for the
 * relations themselves.
 *
 * Pure and DOM-free, like editor/insertMeasure.js: it takes local names and
 * returns quads, so the rules can be asserted without a store or a panel.
 */

import { DataFactory } from 'n3';
import { PREFIXES, expandCurie } from './emit.js';
import d3fendMetadata from '../data/d3fend-metadata.json';
import d3fendCategories from '../data/d3fend-categories.json';

const { namedNode, literal, quad } = DataFactory;

/**
 * The namespace for both the graph and the instances it holds — the `N:` of
 * PREFIXES, so the TriG pane shows `N:db-Database` rather than a full IRI.
 */
export const NEIGHBOUR_GRAPH_BASE = 'urn:d3fend-graph:nbr:';

/** The id used when the prompt comes back empty. */
export const DEFAULT_GRAPH_ID = 'neighbours';

/**
 * A local name n3's Writer will actually abbreviate.
 *
 * Its prefix matcher accepts `[_a-zA-Z0-9][-_a-zA-Z0-9]*` and nothing else
 * (N3Writer's `_prefixRegex`), so anything outside that charset silently
 * demotes the whole IRI to `<urn:d3fend-graph:nbr:…>` in the pane. The `.` of an
 * ATT&CK id becomes `_` rather than being dropped, for the reason
 * editor/insertMeasure.js gives: the dots carry the hierarchy, and `T1110_001`
 * still reads as `T1110.001` where `T1110001` does not.
 */
function localSegment(text) {
  return String(text).replace(/\./g, '_').replace(/[^-_a-zA-Z0-9]/g, '');
}

/**
 * The graph id to use for what the user typed at the prompt.
 *
 * Tighter than the CONSTRUCT slug in main.js, which allows `\w`: this one has to
 * survive n3's charset, since the id is the graph's whole local name.
 */
export function sanitizeGraphId(raw) {
  return localSegment(raw ?? '').replace(/^-+|-+$/g, '') || DEFAULT_GRAPH_ID;
}

/** The graph a neighbourhood is minted into. Named by the user, so several nodes can share one. */
export function neighbourGraphName(graphId) {
  return `${NEIGHBOUR_GRAPH_BASE}${graphId}`;
}

/**
 * The instance standing for one neighbour class *within one graph*.
 *
 * Keyed by the graph and the class, not by the source node: a neighbourhood graph
 * holds one `d3f:Database`, and a second node that also neighbours Database links
 * to that same one rather than minting a rival. That is what makes adding several
 * nodes to one graph accumulate instead of duplicate.
 */
export function neighbourInstanceIri(graphId, localName) {
  return `${NEIGHBOUR_GRAPH_BASE}${graphId}-${localSegment(localName)}`;
}

function branchesOf(localName) {
  return new Set(d3fendCategories[localName] ?? []);
}

/**
 * The same-branch relations of `localName`, sorted and deduplicated.
 *
 * A class can appear more than once: `UserAccount` reaches `UserToUserMessage`
 * through both `d3f:has-sender` and `d3f:has-recipient`, and both are true. The
 * rows stay separate — `neighbourQuads` mints one instance per *class* and one
 * connecting triple per row.
 *
 * Self-relations are dropped (`d3f:File d3f:may-contain d3f:File`): minting an
 * instance for the class the node already is says nothing.
 */
export function neighbourClasses(localName) {
  const roots = branchesOf(localName);
  if (!roots.size) return [];

  const seen = new Set();
  const rows = [];
  for (const rel of d3fendMetadata[localName]?.relations ?? []) {
    const target = rel.targetLocalName;
    if (!target || target === localName) continue;
    if (![...branchesOf(target)].some((root) => roots.has(root))) continue;

    const key = `${target}|${rel.predicate}|${rel.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ targetLocalName: target, predicate: rel.predicate, direction: rel.direction });
  }

  return rows.sort(
    (a, b) =>
      a.targetLocalName.localeCompare(b.targetLocalName) ||
      a.predicate.localeCompare(b.predicate) ||
      a.direction.localeCompare(b.direction),
  );
}

/**
 * The whole neighbourhood of one node as quads, all in `neighbourGraphName(graphId)`.
 *
 * Per neighbour class: an `rdf:type` triple, an `rdfs:label` when the projection
 * has one, and the connecting triple oriented the way the metadata says —
 * `direction: 'out'` is `node predicate instance`, `'in'` is the reverse. The
 * orientation is the part worth getting right: `Directory d3f:may-contain File`
 * written the other way round is a different, false claim.
 *
 * `subjectIri` is the node's own IRI (rdf/emit.js `nodeIri`), passed in rather
 * than rebuilt here so a node that exists only in a query graph works too.
 *
 * The result is deterministic, which is what lets the caller merge two nodes into
 * one graph by plain deduplication: minting the same node twice contributes the
 * same quads, and two nodes sharing a neighbour class contribute the same type
 * and label triples for it.
 */
export function neighbourQuads(subjectIri, localName, graphId) {
  const graph = namedNode(neighbourGraphName(graphId));
  const subject = namedNode(subjectIri);
  const typePredicate = namedNode(`${PREFIXES.rdf}type`);
  const labelPredicate = namedNode(`${PREFIXES.rdfs}label`);

  const quads = [];
  const minted = new Set();
  for (const rel of neighbourClasses(localName)) {
    const target = rel.targetLocalName;
    const instance = namedNode(neighbourInstanceIri(graphId, target));

    if (!minted.has(target)) {
      minted.add(target);
      quads.push(quad(instance, typePredicate, namedNode(`${PREFIXES.d3f}${target}`), graph));
      const label = d3fendMetadata[target]?.label;
      if (label) quads.push(quad(instance, labelPredicate, literal(label), graph));
    }

    const predicate = namedNode(expandCurie(rel.predicate));
    quads.push(
      rel.direction === 'in'
        ? quad(instance, predicate, subject, graph)
        : quad(subject, predicate, instance, graph),
    );
  }
  return quads;
}

/**
 * Adds `incoming` to `existing`, dropping the quads already there.
 *
 * This is what makes a graph id worth prompting for: adding a second node to the
 * same neighbourhood accumulates its new instances and links, while the classes
 * the two nodes share are already present and contribute nothing. Re-minting one
 * node is therefore a no-op, and the caller can say so.
 *
 * Compared on term *values*: n3 builds a fresh object per term, so two quads
 * saying the same thing are never `===` and a Set of the quads themselves would
 * deduplicate nothing. The graph is not part of the key — every quad here belongs
 * to the one graph by construction.
 */
export function mergeQuads(existing = [], incoming = []) {
  const keyOf = (q) => `${q.subject.value}|${q.predicate.value}|${q.object.termType}|${q.object.value}`;
  const seen = new Set(existing.map(keyOf));
  const fresh = [];
  for (const q of incoming) {
    const key = keyOf(q);
    // The Set grows as it goes, so a repeat inside `incoming` is caught too.
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(q);
  }
  return { quads: [...existing, ...fresh], added: fresh.length };
}
