import { DataFactory } from 'n3';
import inverseMap from './inverse-map.json';

const { namedNode, literal, quad } = DataFactory;

/**
 * The *document* prefix set: what the parser expands and what the TriG pane
 * declares.
 *
 * `toTurtle` narrows this to the prefixes a given batch of quads actually uses
 * before handing it to n3's Writer (app/src/rdf/serialize.js), so an entry here
 * costs nothing until a document writes it. That is what made it possible to
 * admit the DPV namespaces — and `ob:`/`al:`, so a CONSTRUCT result added as a
 * drawn graph serialises readably instead of in full IRIs, which ADR 0025's
 * consequences recorded as an accepted wart.
 *
 * Query-layer prefixes (K:, Q:, and each knowledge base's own) still live in
 * QUERY_GRAPH_PREFIXES instead (app/src/query/queryPrefixes.js,
 * docs/adr/0020-sparql-query-engine.md): no document triple can name them.
 */
export const PREFIXES = {
  d3f: 'http://d3fend.mitre.org/ontologies/d3fend.owl#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  G: 'urn:d3fend-graph:',
  E: 'urn:d3fend-graph:enrichment:',
  // Minted D3FEND neighbourhoods (rdf/neighbourGraph.js). `G:` is a proper prefix
  // of this one, which looks fragile and is not: `curieForGraphName` sorts by
  // longest base first, and n3's Writer builds one backtracking alternation of
  // every namespace, so `urn:d3fend-graph:nbr:db` fails as `G:` + `nbr:db` (a ":"
  // is not a legal local name) and retries as `N:` + `db`. What it will *not* do
  // is abbreviate a local name outside [_a-zA-Z0-9][-_a-zA-Z0-9]* — which is why
  // neighbourGraph.js joins with "-" and rewrites the "." of an ATT&CK id.
  N: 'urn:d3fend-graph:nbr:',
  // Writable by a diagram — see TYPING_PREFIXES.
  dpv: 'https://w3id.org/dpv#',
  pd: 'https://w3id.org/dpv/pd#',
  'eu-gdpr': 'https://w3id.org/dpv/legal/eu/gdpr#',
  // Not writable by a diagram, but reachable in the document: query 13's CONSTRUCT
  // writes al:satisfies against an ob: obligation, and the result can be added as a
  // drawn named graph (docs/adr/0021-sparql-query-pane.md).
  ob: 'urn:d3fend-graph:obl:',
  al: 'urn:d3fend-graph:align:',
};

/**
 * The prefixes a *mermaid diagram* may write, as opposed to merely hover over.
 *
 * The line is between vocabularies that describe things in a system — the
 * architecture (`d3f:`), what the data is (`dpv:`, `pd:`), and the GDPR legal
 * roles (`eu-gdpr:`) — and vocabularies that record a judgement *about* a
 * system: `risk:`, `ob:`, `al:`, and DPV's eu-nis2/eu-aiact compliance modules.
 * A risk rating or a statutory duty is something the alignment asserts, not
 * something an author draws a box for.
 *
 * It is also what keeps the parser out of free-text labels. Every prefix here
 * becomes a class token *anywhere* in a node label, so `A[Cache risk:high]`
 * would silently lose its label the moment `risk` joined the set.
 *
 * A literal rather than a projection of the vocabulary registry, so the parser
 * behaves identically whether or not legal-completions.json has been built: a
 * diagram typing `dpv:PersonalData` must not fall back to emitting an
 * `rdfs:label` because a projection is missing.
 */
export const TYPING_PREFIXES = ['d3f', 'dpv', 'pd', 'eu-gdpr'];

export function expandCurie(curie) {
  const [prefix, local] = curie.split(':');
  const base = PREFIXES[prefix];
  return base ? base + local : curie;
}

/**
 * Reverses a prefix map to render any IRI as a CURIE (e.g. "G:current",
 * "d3f:Artifact"), longest matching base first so "E:x" beats "G:enrichment:x".
 * Returns the IRI unchanged when nothing matches.
 */
export function curieWith(iri, prefixes) {
  const [prefix, base] = Object.entries(prefixes)
    .filter(([, b]) => iri.startsWith(b))
    .sort((a, b) => b[1].length - a[1].length)[0] || [];
  return base ? `${prefix}:${iri.slice(base.length)}` : iri;
}

/** Reverses PREFIXES to render a named-graph IRI as an identifier-style CURIE. */
export function curieForGraphName(iri) {
  return curieWith(iri, PREFIXES);
}

export function nodeIri(nodeId) {
  return `urn:d3fend-graph:${nodeId}`;
}

/**
 * True when an edge label names a predicate a diagram may write — it carries one of
 * TYPING_PREFIXES.
 *
 * Everything else is dropped by the parser with a warning, including a bare
 * `|accesses|`. Implying `d3f:` on an unprefixed label looked like a convenience and
 * was a trap: it cannot distinguish a shorthand for a real property from prose, so
 * mta.md's `|a|` and `|subClassOf|` became `d3f:a` and `d3f:subClassOf`, predicates
 * that do not exist in any vocabulary. An unwritable *prefix* (`|risk:foo|`) is
 * dropped for the same reason rather than rewritten.
 */
export function isWritablePredicate(label) {
  const at = label.indexOf(':');
  return at > 0 && TYPING_PREFIXES.includes(label.slice(0, at));
}

/**
 * inverse-map.json names each pair once, in whichever direction reads better —
 * `d3f:uses` → `d3f:used-by`. Inversion is symmetric, so the reverse of every
 * entry is derived here rather than written out by hand: a diagram that writes the
 * passive leg (`|d3f:used-by|`, as 001-layers.md and db-replica.md do) is just as
 * swappable as one that writes the active one, and having only the active
 * direction in the file silently cost it both the swap item and the `s` key. An
 * explicit entry wins over a derived one, and a self-inverse predicate
 * (`d3f:communicates-with`) maps to itself either way.
 *
 * The file's first block is D3FEND's own `owl:inverseOf` declarations plus its one
 * `owl:SymmetricProperty`; the second is the invented names, kept because those
 * predicates are drawable but have no inverse in the ontology (`d3f:read-by` is
 * not a property — see viz/edgePanel.js, which is why the panel never looks an
 * inverse up in the term metadata). Note `d3f:contains` reaches the graph as
 * containment rather than as an edge (emitQuads below), so only the
 * `d3f:contained-by` leg of that pair is ever drawn as a swappable link.
 */
const symmetricInverses = new Map();
for (const [predicate, inverse] of Object.entries(inverseMap)) {
  if (!symmetricInverses.has(inverse)) symmetricInverses.set(inverse, predicate);
}
for (const [predicate, inverse] of Object.entries(inverseMap)) {
  symmetricInverses.set(predicate, inverse);
}

/** Looks up the well-known inverse predicate name for a d3f: predicate, if any. */
export function inversePredicateOf(predicate) {
  return symmetricInverses.get(predicate) || null;
}

/**
 * Converts a parsed diagram AST (see parser/index.js) into an array of N3 quads.
 *
 * This is the *only* mermaid-aware step: the quads are the sole hand-off to the
 * rest of the app, so anything the graph view needs must be representable in RDF
 * (see docs/adr/0014-graph-view-from-rdf-only.md). Purely presentational mermaid
 * syntax, such as the dotted/solid arrow style, is therefore dropped here.
 *
 * `taggedIds` widens the "does this id carry a d3f: class?" check beyond this
 * single AST to every block of the document (see main.js). Node identity is the
 * IRI, so a class attached to an id in any diagram types the same resource here
 * too — which is what lets a subgraph re-opened without a title (db-replica.md)
 * still count as tagged. Omitting it falls back to this AST alone.
 */
export function emitQuads(ast, diagramId, { taggedIds = null } = {}) {
  const quads = [];
  const graph = namedNode(`urn:d3fend-graph:${diagramId}`);

  const nodeById = new Map(ast.nodes.map((n) => [n.id, n]));
  const subgraphById = new Map(ast.subgraphs.map((s) => [s.id, s]));

  const isTagged = (id) =>
    !!taggedIds?.has(id) ||
    !!subgraphById.get(id)?.classes.length ||
    !!nodeById.get(id)?.classes.length;

  // A subgraph declaration wins over a bare node occurrence of the same id,
  // except when only the occurrence knows the parent: `subgraph net ... padding
  // ... end` followed by a top-level `subgraph padding [...]` nests padding in
  // net, exactly as mermaid renders it.
  const declaredParent = (id) => subgraphById.get(id)?.parent ?? nodeById.get(id)?.parent;

  /**
   * The nearest *tagged* ancestor. An untagged subgraph is presentational
   * padding rather than an entity, so it emits no triples and is walked through:
   * its children are re-parented to whatever tagged container encloses it.
   *
   * "Tagged" means carrying a class in *any* vocabulary a diagram may write, not
   * just `d3f:` — `isTagged` only ever asked whether `classes` was non-empty, so
   * this held the moment the parser learned the other prefixes. ADR 0028 proposed
   * treating a `dpv:`-only subgraph as padding instead; that would have meant
   * adding a prefix check here to silently discard a tag the editor had just
   * autocompleted, so it is not done.
   */
  const effectiveParent = (id) => {
    let parentId = declaredParent(id);
    const seen = new Set([id]); // forward references can form cycles
    while (parentId && subgraphById.has(parentId) && !isTagged(parentId)) {
      if (seen.has(parentId)) return undefined;
      seen.add(parentId);
      parentId = declaredParent(parentId);
    }
    return parentId;
  };

  // Nodes before subgraphs, deduped by id: an id declared both ways (a bare node
  // inside one subgraph, a subgraph of its own elsewhere) is one child, listed
  // where the node first appeared.
  const childrenByParent = new Map();
  const placed = new Set();
  for (const id of [...ast.nodes.map((n) => n.id), ...ast.subgraphs.map((s) => s.id)]) {
    if (placed.has(id)) continue;
    placed.add(id);
    // Untagged ids are absent from the graph entirely, so nothing contains them.
    if (!isTagged(id)) continue;
    const parentId = effectiveParent(id);
    if (!parentId) continue;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(id);
  }

  for (const node of ast.nodes) {
    if (!node.classes.length) continue;
    const subject = namedNode(nodeIri(node.id));
    for (const cls of node.classes) {
      quads.push(quad(subject, namedNode(PREFIXES.rdf + 'type'), namedNode(expandCurie(cls)), graph));
    }
    if (node.label) {
      quads.push(quad(subject, namedNode(PREFIXES.rdfs + 'label'), literal(node.label), graph));
    }
  }

  for (const sg of ast.subgraphs) {
    if (!sg.classes.length) continue;
    const subject = namedNode(nodeIri(sg.id));
    for (const cls of sg.classes) {
      quads.push(quad(subject, namedNode(PREFIXES.rdf + 'type'), namedNode(expandCurie(cls)), graph));
    }
    if (sg.label) {
      quads.push(quad(subject, namedNode(PREFIXES.rdfs + 'label'), literal(sg.label), graph));
    }
  }

  // Containment reaches the graph view as d3f:contains triples, nothing else:
  // the view rebuilds the compound hierarchy from them (rdf/graphModel.js).
  for (const sg of ast.subgraphs) {
    // isTagged, not sg.classes: a subgraph re-opened without a title in another
    // block of the same document is still the tagged resource (db-replica.md).
    if (!isTagged(sg.id)) continue;
    const children = childrenByParent.get(sg.id) || [];
    if (!children.length) continue;
    const subject = namedNode(nodeIri(sg.id));
    const containsPredicate = namedNode(expandCurie('d3f:contains'));
    for (const childId of children) {
      quads.push(quad(subject, containsPredicate, namedNode(nodeIri(childId)), graph));
    }
  }

  for (const edge of ast.edges) {
    // Already filtered by the parser, which warns; belt and braces for a hand-built
    // AST, and it keeps `d3f:dpv:hasDataSubject` unreachable from any path.
    if (!isWritablePredicate(edge.predicate)) continue;
    const predicateCurie = edge.predicate;
    const subject = namedNode(nodeIri(edge.from));
    const object = namedNode(nodeIri(edge.to));
    const predicate = namedNode(expandCurie(predicateCurie));
    quads.push(quad(subject, predicate, object, graph));
  }

  return { quads, graphName: graph.value };
}
