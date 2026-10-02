import { VOCABULARIES } from './vocabularies.js';
import { hierarchyText, isLabelRedundant } from './d3fendHierarchy.js';

// Rank 2: below the document's own node ids, which are the closer match while
// authoring a diagram (see nodeCompletion.js). The legal vocabularies rank below
// D3FEND, which is where a diagram's tags mostly come from — see vocabularies.js.
export const ONTOLOGY_SECTION = { name: 'D3FEND ontology', rank: 2 };

// One completion set per vocabulary, each with its own trigger. Splitting them means
// typing `dpv:` offers 2 000 legal terms rather than 12 000 of everything, and the
// section header names which vocabulary you are in.
const SETS = VOCABULARIES.map((vocabulary) => {
  const section =
    vocabulary.prefix === 'd3f'
      ? ONTOLOGY_SECTION
      : { name: vocabulary.label, rank: vocabulary.rank };

  // Deprecated terms are left out: completion writes new text, and the hover card
  // and the node panel still describe — and offer to replace — one already written
  // (docs/adr/0041-deprecated-d3fend-terms.md).
  const current = Object.entries(vocabulary.terms).filter(([, item]) => !item.deprecated);

  return {
    // Only complete right after "<prefix>:", replacing the partial word typed so far.
    // `.` and `-` are in the local-name charset because D3FEND ids and article
    // references both use them (ob:nis2-art21-2-h).
    trigger: new RegExp(`${vocabulary.prefix}:([\\w.-]*)$`),
    options: current.flatMap(([name, item]) => {
      const qname = `${vocabulary.prefix}:${name}`;
      const option = {
        label: qname,
        type: item.kind === 'property' ? 'property' : 'class',
        detail: item.label,
        section,
        // `infoText`, not CodeMirror's `info`: a function-valued `info` must return a
        // DOM node, and returning a string from one throws inside the completion
        // popup — which crashes the tooltip plugin, and CodeMirror then *deactivates*
        // it, taking the hover cards down with it for the rest of the page's life.
        // The panel renders this text itself (completionPanel.js), so the field stays
        // plain text: lazy, and testable without a DOM.
        infoText: () => hierarchyText(qname),
      };
      if (!item.label || isLabelRedundant(item.label, name)) return [option];
      return [option, labelAlias(vocabulary.prefix, option, item.label)];
    }),
  };
});

/**
 * A second row for a term whose id says nothing about it — `d3f:T1566` is
 * "Phishing" — so typing `d3f:phish` finds it.
 *
 * CodeMirror filters on `label` only, so the alias puts the rdfs:label there and
 * writes the id through `apply`; `displayLabel` shows the id, which is what lands
 * in the text. `boost: -1` ranks it below every id match, so `d3f:T15` still lists
 * the T15xx ids first.
 */
function labelAlias(prefix, option, label) {
  return {
    ...option,
    label: `${prefix}:${label}`,
    displayLabel: option.label,
    apply: option.label,
    boost: -1,
  };
}

/** The d3f: trigger, kept as a named export because the editor pane advertises it. */
export const D3F_PREFIX = /d3f:([\w.-]*)$/;

// CodeMirror `CompletionSource`: given the current editing context, returns
// a completion result or null if this position isn't a vocabulary reference.
export function d3fendCompletionSource(context) {
  for (const set of SETS) {
    const match = context.matchBefore(set.trigger);
    // `ob:` also ends in `:`, but the triggers are anchored on the prefix itself, so
    // only the vocabulary actually typed can match — no ambiguity to resolve.
    if (!match) continue;
    return { from: match.from, options: set.options, validFor: set.trigger };
  }
  return null;
}
