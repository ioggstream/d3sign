import { VOCABULARIES, qualify, splitQname, termOf, vocabularyFor } from './vocabularies.js';

const CHARACTERISTIC_MARKERS = {
  transitive: '(T)',
  symmetric: '(S)',
};

/**
 * Terms are addressed by qname — "d3f:Password", "ob:nis2-art21-2-h" — because a bare
 * local name is only unique inside one vocabulary, and there is more than one now
 * (vocabularies.js). The D3FEND projection stores `parents` as bare names, the legal
 * one as qnames, so everything read out of an item is qualified against its own
 * vocabulary on the way through.
 */

// qname -> direct children as qnames, inverted from `parents` once at load.
const CHILDREN = {};
for (const { prefix, terms } of VOCABULARIES) {
  for (const [name, item] of Object.entries(terms)) {
    for (const parent of item.parents ?? []) {
      (CHILDREN[qualify(prefix, parent)] ??= []).push(`${prefix}:${name}`);
    }
  }
}
for (const key of Object.keys(CHILDREN)) {
  CHILDREN[key].sort();
}

export const getItem = (qname) => termOf(qname);

export const getChildren = (qname) => CHILDREN[qname] ?? [];

// Human-readable name of a term, falling back to the qname for one no vocabulary
// knows — which is what a hand-typed or misspelled reference looks like.
export const labelOf = (qname) => getItem(qname)?.label ?? qname;

/**
 * Whether `label` is just `localName` with spaces and case added — e.g.
 * "File Eviction" for `FileEviction` — so printing both is the same fact
 * twice. Not true of an ATT&CK-derived class like `T1566`, whose label
 * ("Phishing") shares no text with the id at all.
 *
 * Here rather than in the node panel because completion needs it too: a term
 * whose label is not redundant is one whose id cannot be found by its name.
 */
export function isLabelRedundant(label, localName) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalize(label) === normalize(localName);
}

/**
 * `{ replacedBy: [qname] }` for a deprecated term, `null` otherwise. `replacedBy`
 * is empty when the ontology states no replacement
 * (docs/adr/0041-deprecated-d3fend-terms.md).
 */
export function deprecationNote(qname) {
  const parts = splitQname(qname);
  const item = getItem(qname);
  if (!parts || !item?.deprecated) return null;
  return { replacedBy: (item.replacedBy ?? []).map((name) => qualify(parts.prefix, name)) };
}

/**
 * "Deprecated, use Hijack Execution Flow (d3f:T1574.010)", or plain "Deprecated"
 * when no replacement is stated. One wording for the hover card, the node panel's
 * badge and its class dropdown.
 */
export function deprecationText({ replacedBy }) {
  if (!replacedBy.length) return 'Deprecated';
  return `Deprecated, use ${replacedBy.map((q) => `${labelOf(q)} (${q})`).join(' or ')}`;
}

/** A term's own parents, as qnames — the projections store them either way. */
export function getParents(qname) {
  const parts = splitQname(qname);
  const item = getItem(qname);
  if (!parts || !item) return [];
  return (item.parents ?? []).map((parent) => qualify(parts.prefix, parent));
}

/**
 * The classes a "change class" dropdown offers instead of `qname`: its
 * parents, its siblings (the other children of each parent), and its
 * children. Deduplicated and with `qname` itself removed from siblings —
 * `getChildren(parent)` includes the class it was asked about.
 */
export function getAlternatives(qname) {
  const parents = getParents(qname);
  const siblings = [...new Set(parents.flatMap(getChildren))].filter((sibling) => sibling !== qname);
  const children = getChildren(qname);
  return { parents, siblings, children };
}

// Root-first chain of ancestor labels above `qname`, following the first parent at
// each level. Guards against cycles in malformed ontology data.
export function getAncestorPath(qname) {
  const path = [];
  const visited = new Set([qname]);
  let current = qname;
  for (;;) {
    const [parent] = getParents(current);
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    path.unshift(labelOf(parent));
    current = parent;
  }
  return path;
}

/**
 * Everything worth saying about one term, as data: title, link, definition with
 * its characteristic markers, ancestor path, inverse-of, parents, children.
 * Undefined for a qname no loaded vocabulary knows.
 *
 * The single source of truth for *what* a term's description contains. The two
 * renderers — `hierarchyText` below for the completion popup, `renderD3fendCard`
 * for the hover tooltip — decide only how to draw it, which is what keeps them
 * from drifting apart or repeating each other.
 */
export function termSections(qname) {
  const parts = splitQname(qname);
  const item = getItem(qname);
  if (!parts || !item) return undefined;

  const markers = (item.characteristics ?? [])
    .map((c) => CHARACTERISTIC_MARKERS[c])
    .filter(Boolean)
    .join(' ');

  return {
    name: qname,
    label: item.label,
    title: `${item.label} (${qname})`,
    // Null for the hand-authored vocabularies: there is no page for
    // ob:nis2-art21-2-h, and a link that 404s is worse than no link.
    url: vocabularyFor(parts.prefix)?.url?.(parts.name) ?? null,
    documentation: markers ? `${item.documentation} ${markers}` : item.documentation,
    // Legal citations — [{label, url}] dereferenced from dct:source by
    // build-legal-metadata.py. Empty for D3FEND, which cites nothing per term.
    sources: item.sources ?? [],
    // Root-first ancestor labels, already display-ready.
    path: getAncestorPath(qname),
    inverseOf: item.inverseOf ? qualify(parts.prefix, item.inverseOf) : null,
    // `{ replacedBy }` on a deprecated term, null otherwise — see `deprecationNote`.
    deprecation: deprecationNote(qname),
    parents: getParents(qname),
    children: getChildren(qname),
  };
}

// Plain-text rendering of `termSections`, for the completion popup's `info`
// pane, which takes a string rather than DOM.
export function hierarchyText(qname) {
  const sections = termSections(qname);
  if (!sections) return undefined;

  const lines = [sections.documentation];
  if (sections.deprecation) lines.push(deprecationText(sections.deprecation));
  if (sections.sources.length) lines.push(`Source: ${sections.sources.map((s) => s.label).join('; ')}`);
  if (sections.path.length) lines.push(`Path: ${sections.path.join(' › ')}`);
  if (sections.inverseOf) lines.push(`Inverse: ${sections.inverseOf}`);
  if (sections.parents.length) lines.push(`Parents: ${sections.parents.join(', ')}`);
  if (sections.children.length) lines.push(`Children: ${sections.children.join(', ')}`);

  return lines.filter(Boolean).join('\n\n');
}
