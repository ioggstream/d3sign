/**
 * The vocabularies the editor knows terms of.
 *
 * `d3f:` used to be the only one, and its local name was the identity of a term
 * everywhere in this folder. That stopped working once the legal knowledge bases
 * arrived: `ob:nis2-art21-2-h` and `dpv:EncryptionAtRest` are terms a diagram author
 * types and wants explained, and a bare local name cannot say which vocabulary it
 * came from. So the identity is now the **qname** — the whole `prefix:LocalName`
 * string, exactly what is written in the document.
 *
 * Each vocabulary carries a flat map of local name to
 * `{ label, kind, documentation, parents, inverseOf?, characteristics? }`. The legal
 * projection deliberately uses the same item shape as the D3FEND one, so
 * d3fendHierarchy.js reads both through one code path (see
 * app/scripts/build-legal-metadata.py).
 *
 * Both maps are precomputed JSON rather than the knowledge bases themselves, because
 * completion and hover run on a keystroke and cannot wait for the query worker to
 * fetch and parse 30k triples (docs/adr/0020-sparql-query-engine.md).
 */

import { TYPING_PREFIXES } from '../rdf/emit.js';
import d3fendTerms from '../data/d3fend-completions.json';
import legalTerms from '../data/legal-completions.json';

/**
 * `rank` is the completion section order: document node ids come first (rank 1, see
 * nodeCompletion.js), then D3FEND, then the legal vocabularies. Typing `d3f:` filters
 * to one vocabulary anyway; the ranking only matters when several offer a match.
 *
 * `url(name)` is where "read the real definition" points. The hand-authored
 * vocabularies have none — there is no page for `ob:nis2-art21-2-h`, and inventing a
 * link that 404s is worse than showing no link at all.
 *
 * `typing` says whether a diagram may use the vocabulary's terms as node types and
 * edge predicates — see TYPING_PREFIXES below. Every vocabulary here is hoverable and
 * completable either way; that is what ADR 0025 promised and it does not change.
 *
 * The prefix labels are upstream's own: `legal.ttl.gz` declares `eu-gdpr:`, not
 * `gdpr:`, so a term copied out of the DPV documentation resolves without translation.
 */
const LEGAL_VOCABULARIES = [
  ['dpv', 'DPV', (name) => `https://w3id.org/dpv#${name}`, true],
  ['pd', 'DPV personal data', (name) => `https://w3id.org/dpv/pd#${name}`, true],
  ['risk', 'DPV risk', (name) => `https://w3id.org/dpv/risk#${name}`, false],
  ['tech', 'DPV tech', (name) => `https://w3id.org/dpv/tech#${name}`, false],
  ['eu-gdpr', 'DPV — EU GDPR', (name) => `https://w3id.org/dpv/legal/eu/gdpr#${name}`, true],
  ['eu-nis2', 'DPV — EU NIS2', (name) => `https://w3id.org/dpv/legal/eu/nis2#${name}`, false],
  ['eu-aiact', 'DPV — EU AI Act', (name) => `https://w3id.org/dpv/legal/eu/aiact#${name}`, false],
  ['ob', 'Obligations', null, false],
  ['al', 'D3FEND alignment', null, false],
];

export const VOCABULARIES = [
  {
    prefix: 'd3f',
    label: 'D3FEND ontology',
    rank: 2,
    terms: d3fendTerms,
    url: (name) => `https://d3fend.mitre.org/dao/d3f:${name}`,
    typing: true,
  },
  // Skipped when the projection has nothing for them: legal-completions.json ships
  // empty until app/scripts/build-legal-metadata.py has been run, and a vocabulary
  // with no terms would otherwise contribute an empty completion section and a
  // hover regex that never matches anything.
  ...LEGAL_VOCABULARIES.filter(([prefix]) => Object.keys(legalTerms[prefix] ?? {}).length).map(
    ([prefix, label, url, typing], index) => ({
      prefix,
      label,
      rank: 3 + index,
      terms: legalTerms[prefix],
      url,
      typing,
    }),
  ),
];

/** The registered vocabularies a diagram may write — see TYPING_PREFIXES in emit.js. */
export function typingVocabularies() {
  return VOCABULARIES.filter((vocabulary) => vocabulary.typing);
}

const BY_PREFIX = new Map(VOCABULARIES.map((vocabulary) => [vocabulary.prefix, vocabulary]));

export function vocabularyFor(prefix) {
  return BY_PREFIX.get(prefix) ?? null;
}

/** Splits "dpv:EncryptionAtRest" into its parts, or null if it is not a qname. */
export function splitQname(qname) {
  const at = typeof qname === 'string' ? qname.indexOf(':') : -1;
  if (at < 1) return null;
  return { prefix: qname.slice(0, at), name: qname.slice(at + 1) };
}

/** Qualifies a bare local name against a vocabulary, and leaves a qname alone. */
export function qualify(prefix, nameOrQname) {
  return nameOrQname.includes(':') ? nameOrQname : `${prefix}:${nameOrQname}`;
}

/** The term one qname names, or undefined if no loaded vocabulary has it. */
export function termOf(qname) {
  const parts = splitQname(qname);
  if (!parts) return undefined;
  return vocabularyFor(parts.prefix)?.terms[parts.name];
}

/**
 * Matches any known vocabulary's term in text — `d3f:Password`, `ob:nis2-art21-2-h`.
 *
 * Built from the registry so the set of hoverable prefixes cannot disagree with the
 * set of completable ones. The prefix is anchored on a non-word character rather than
 * `\b` so `https://w3id.org/dpv#x` does not read as a `dpv:`-ish token, and the local
 * name allows the `-` and `.` that D3FEND ids and article references both use.
 *
 * Alternatives are sorted longest-first: a regex alternation is first-match, so a
 * shorter prefix that is a suffix of a longer one would win and truncate the token.
 * `-` is a non-word character, so the lookbehind does not stop `gdpr:X` from matching
 * inside `eu-gdpr:X` — which is why only one of the two spellings may be registered.
 */
export function termTokenPattern() {
  return new RegExp(`(?<![\\w:])(${prefixAlternation(VOCABULARIES)}):([\\w.-]+)`, 'g');
}

/** `prefix|prefix|…`, longest first — see termTokenPattern for why the order matters. */
export function prefixAlternation(vocabularies) {
  return vocabularies
    .map((vocabulary) => vocabulary.prefix)
    .sort((a, b) => b.length - a.length)
    .join('|');
}
