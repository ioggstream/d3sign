# 41. Deprecated D3FEND terms

Date: 2026-09-25

## Status

Accepted

## Context

D3FEND 1.6 marks 232 classes `owl:deprecated true`,
mostly ATT&CK techniques that MITRE revoked, such as
`d3f:T1093` "Process Hollowing", now `d3f:T1055.012`.

The editor treated them as current terms:

- completion offered them next to their replacements;
- the class dropdown of the node panel
  ([ADR 0039](0039-change-node-class.md)) listed them
  unmarked;
- the node panel badge said "deprecated" without
  naming what to use instead.

D3FEND states no `dcterms:isReplacedBy`. It names the
replacement in two places:

- `rdfs:seeAlso d3f:<class>`, on 186 classes; the
  other `rdfs:seeAlso` objects are external URLs;
- `rdfs:comment`, e.g. "This technique has been
  revoked by T1574.010", which agrees with
  `rdfs:seeAlso` on all 186 and covers 2 more.

44 classes state no replacement.

## Decision

- [x] The term projection carries `deprecated` and
  `replacedBy` on every deprecated class. `replacedBy`
  is read from the first source that names a known
  class: `dcterms:isReplacedBy`, then `rdfs:seeAlso`,
  then the `rdfs:comment` text after "revoked by" or
  "superseded … by". It is empty when none does.
- [x] Completion leaves deprecated terms out.
  Completion writes new text; a term already written
  is still described by the hover card and the panel.
- [x] The hover card of a deprecated term names the
  replacement, with a "Replace with" button that
  rewrites the hovered token.
- [x] The class dropdown marks every deprecated entry
  and names its replacement in the option text. When
  the current class is deprecated, a first
  "Replaced by" group makes the move one pick.
- [x] The node panel badge names the replacement.

## Consequences

Pros:

- A document written against an older D3FEND release
  can be moved to the current one term by term, from
  the editor or from the panel.
- New text cannot pick a revoked technique by
  accident.

Cons:

- The comment fallback parses free text. A rewording
  upstream drops those 2 replacements silently, and
  `rdfs:seeAlso` is not a replacement predicate by
  definition: a future `rdfs:seeAlso` to a related,
  non-replacing class would be read as one.
- A deprecated term can no longer be completed, even
  on purpose: it has to be typed in full.
- The option text of the dropdown gets long; an
  `<option>` takes no styling browsers draw reliably,
  so the mark cannot be visual only.

## DONTREADME

Notes for LLM agents. They describe the code as it
is, not the decision, and go stale: check the code
before trusting them.

- `app/scripts/build-d3fend-completions.py`:
  `replaced_by(g, c, classes)` and the two fields,
  written only when deprecated. Regenerate with
  `app/scripts/rebuild-data.sh`.
- `app/src/editor/d3fendHierarchy.js`:
  `deprecationNote(qname)` returns
  `{ replacedBy: [qname] }` or `null`;
  `deprecationText` is the one wording;
  `termSections(...).deprecation` feeds the card.
- `app/src/editor/d3fendCompletion.js` filters on
  `item.deprecated`.
- `app/src/editor/d3fendCard.js` takes an optional
  `onReplace`; `d3fendHover.js` passes it only while
  the card shows the hovered term, not after
  navigating.
- `app/src/viz/nodePanel.js`: `classSwapLabel` and
  the "Replaced by" optgroup in `renderClassSwap`;
  the badge reads the term projection, since
  `d3fend-metadata.json` carries the flag only.
