/**
 * The D3FEND class hierarchy walked at query time, so a relation stated on a
 * superclass is a relation of the class.
 *
 * D3FEND states almost nothing on a leaf. `d3f:WebServerApplication` carries no
 * relation of its own; everything it can do is stated on `d3f:Application` and
 * `d3f:Software`. `data/d3fend-metadata.json` is indexed per class with no
 * `rdfs:subClassOf*` closure (app/scripts/build-d3fend-metadata.py), so 2160 of
 * its 3655 classes list no relations at all and 1201 of those have ancestors
 * that do. The panels read this module instead of the file directly.
 *
 * The closure is walked here rather than baked into the file because it does not
 * fit: 3154 rows become 30643, on a projection already 2.0 MB. Walking it costs
 * nothing at this depth — ancestors per class run to a median of 7 and a maximum
 * of 15 — and the walk is memoised per class anyway.
 *
 * Everything here is pure and reads only the two JSON projections, so it is
 * usable on a keystroke path and testable without a DOM or the query worker.
 * The equivalent SPARQL is data/queries/15-alternative-links-between.rq, and
 * test/d3fend-restrictions.test.js holds the two to the same answers.
 */

import { getParents } from './d3fendHierarchy.js';
import { inversePredicateOf } from '../rdf/emit.js';
import d3fendMetadata from '../data/d3fend-metadata.json';

/** `WebServerApplication` -> `d3f:WebServerApplication`, the hierarchy's key. */
const qnameOf = (localName) => `d3f:${localName}`;

/** `d3f:Software` -> `Software`, the metadata projection's key. */
const localNameOf = (qname) => (qname.startsWith('d3f:') ? qname.slice(4) : qname);

const ancestorCache = new Map();

/**
 * Every class above `localName`, nearest first, as bare local names.
 *
 * Breadth-first over *all* parents. `getAncestorPath` in d3fendHierarchy.js
 * follows only the first one, which is fine for the display path it feeds and
 * wrong here: 504 D3FEND classes have more than one parent, and taking the first
 * silently drops the branch the relation is stated on.
 *
 * `visited` is seeded with the class itself, so a cycle in malformed ontology
 * data terminates and `includeSelf` cannot produce a duplicate.
 */
export function getAncestors(localName, { includeSelf = false } = {}) {
  const cacheKey = `${localName}|${includeSelf}`;
  const cached = ancestorCache.get(cacheKey);
  if (cached) return cached;

  const visited = new Set([localName]);
  const out = includeSelf ? [localName] : [];
  const queue = [localName];
  while (queue.length) {
    for (const parent of getParents(qnameOf(queue.shift()))) {
      const name = localNameOf(parent);
      if (visited.has(name)) continue;
      visited.add(name);
      out.push(name);
      queue.push(name);
    }
  }

  ancestorCache.set(cacheKey, out);
  return out;
}

/**
 * `rdfs:subClassOf*` as a predicate: is `a` the same class as `b`, or below it?
 *
 * Reflexive, matching the `*` in the query, and the only direction test the
 * tiers need — asking it the other way round covers the descendant case, so
 * nothing here ever enumerates subclasses.
 */
export function isSubClassOf(a, b) {
  if (a === b) return true;
  return getAncestors(a).includes(b);
}

/**
 * How well an end of the drawn link matches the other end of an axiom.
 *
 * `exact` — the axiom's filler is the node's class or one of its superclasses,
 * so the link is licensed as drawn. `narrower` — the filler is *below* the
 * node's class, so the axiom is about a more specific thing than the diagram
 * says; still worth offering, and marked. Null is no relationship at all, which
 * is the loose tier this module deliberately does not return (see the `.rq`).
 */
function tierOf(nodeClass, filler) {
  if (isSubClassOf(nodeClass, filler)) return 'exact';
  if (isSubClassOf(filler, nodeClass)) return 'narrower';
  return null;
}

const relationsCache = new Map();

/**
 * A class's relations, its ancestors' included, nearest ancestor first.
 *
 * Each row is a `d3fend-metadata.json` row plus `via`: the class the relation is
 * actually stated on, or null when it is the class's own. That is the part a
 * reader cannot otherwise recover — "this is here because it is Software" is the
 * whole answer to why an empty panel is no longer empty.
 *
 * Deduplicated on what the panel draws, the way the build script already
 * deduplicates direct triples against restrictions: the nearest statement wins,
 * so a relation restated on a subclass keeps `via: null`.
 */
export function relationsFor(localName, { includeInherited = true } = {}) {
  if (!includeInherited) return d3fendMetadata[localName]?.relations ?? [];

  const cached = relationsCache.get(localName);
  if (cached) return cached;

  const seen = new Set();
  const rows = [];
  for (const cls of getAncestors(localName, { includeSelf: true })) {
    for (const rel of d3fendMetadata[cls]?.relations ?? []) {
      const key = `${rel.predicate}|${rel.direction}|${rel.targetLocalName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...rel, via: cls === localName ? null : cls });
    }
  }

  relationsCache.set(localName, rows);
  return rows;
}

/**
 * The predicates that could connect `sourceClass` to `targetClass`, each naming
 * the class whose axiom licenses it.
 *
 * Two branches, mirroring the two in the `.rq`. `out` walks the source's
 * ancestors for a relation whose other end matches the target; `in` walks the
 * target's ancestors for one pointing back at the source, which is the same
 * arrow written the other way round and is invisible to the outgoing branch
 * alone — `d3f:WebServerApplication -> d3f:Process` finds `d3f:instructs` going
 * out and `d3f:instructed-by` coming in, and only the ontology knows which one
 * the author meant.
 *
 * Only `direction: 'out'` metadata rows are read, in both branches: those are
 * the `?via ?property ?filler` triples the query matches, and the `in` rows are
 * the same statements indexed from the other end. Reading both would return
 * every candidate twice.
 *
 * `inverse` comes from rdf/inverse-map.json rather than from the ontology's
 * `owl:inverseOf`, which the completion projection does not carry: it is what
 * decides whether `s` can swap the link once it is written
 * (docs/adr/0019-select-and-swap-edges.md), so it is null exactly when the swap
 * would decline.
 */
export function alternativesBetween(sourceClass, targetClass) {
  const rows = [];
  const branches = [
    { direction: 'out', walk: sourceClass, match: targetClass },
    { direction: 'in', walk: targetClass, match: sourceClass },
  ];

  for (const { direction, walk, match } of branches) {
    for (const via of getAncestors(walk, { includeSelf: true })) {
      for (const rel of d3fendMetadata[via]?.relations ?? []) {
        if (rel.direction !== 'out') continue;
        const tier = tierOf(match, rel.targetLocalName);
        if (!tier) continue;
        rows.push({
          direction,
          tier,
          predicate: rel.predicate,
          via,
          filler: rel.targetLocalName,
          inverse: inversePredicateOf(rel.predicate),
          kind: rel.kind,
        });
      }
    }
  }

  // A property whose two ends are the same class is found by both branches -
  // `d3f:may-contain` on `d3f:File -> d3f:File`. The outgoing row is the one
  // that reads the way the arrow is drawn, so it is the one kept.
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = `${row.predicate}|${row.via}|${row.filler}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        // Outgoing first, then the better tier: `in` and `narrower` both sort
        // ahead of their partner alphabetically, so neither can be left to it.
        (a.direction === b.direction ? 0 : a.direction === 'out' ? -1 : 1) ||
        (a.tier === b.tier ? 0 : a.tier === 'exact' ? -1 : 1) ||
        a.predicate.localeCompare(b.predicate),
    );
}
