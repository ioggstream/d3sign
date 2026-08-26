/**
 * The mermaid link operators, in one place.
 *
 * Three modules have to agree about what an arrow looks like: the edge parser
 * (edgeParser.js), the mask that blanks arrows before ids are tokenized
 * (editor/mermaidMasking.js) and the back-arrow diagnostic that both the parser
 * warnings and the editor decoration read. They used to hold three regexes of
 * their own, which is the drift docs/adr/0017-go-to-mermaid-source.md warns
 * about. This module imports nothing, so anyone may depend on it.
 */

// `[>ox]` because mermaid draws three arrow heads: `-->` (arrow), `--o` (circle)
// and `--x` (cross). The head is presentation, so all three yield the same
// triple — see the `edge-forms` case in data/examples/testcases.md.
//
// `<` can only ever be an arrow head, but `o` and `x` are legal id characters
// (ID_RE is `[A-Za-z0-9_-]+`), so in `repo-->|p| b` the `o` belongs to `repo`.
// A bare o/x head therefore counts only where an id cannot end: glued to the
// dashes, with whitespace or `&` before it — which is how mermaid writes it
// (`a o--o b`). Mermaid is as ambiguous as we are about a node called `x`.
const LEFT_HEAD = String.raw`(?:<|(?<=[\s&])[ox])`;
const DASHES = String.raw`-{1,3}\.?-{0,2}`;
const RIGHT_HEAD = String.raw`[>ox]`;

/** The arrows the parser understands: dashes, optionally dotted, with heads. */
export const ARROW = `${LEFT_HEAD}?${DASHES}${RIGHT_HEAD}?`;

/**
 * Any link operator, labelled or not, including the thick and invisible styles
 * `ARROW` does not accept (`==>`, `~~~`). Deliberately wider: this is what
 * masks arrows away and what hunts for mistakes, so it has to see the lines the
 * parser refuses as well as the ones it takes. Two *or more* dashes matters — a
 * single `-` is a legal id character, so `dc-1-net` must survive untouched.
 */
export const ANY_LINK_SOURCE = `${LEFT_HEAD}?[-=.~]{2,}${RIGHT_HEAD}?`;

/** The heads a link operator carries, `null` where it has none. */
export function linkHeads(link) {
  return {
    left: /^[<ox]/.test(link) ? link[0] : null,
    right: new RegExp(`${RIGHT_HEAD}$`).test(link) ? link[link.length - 1] : null,
  };
}

/**
 * A head on the left and none on the right: `c <--|p| d`, `c o-- d`. Mermaid has
 * no back arrows — `<--`, `o--` and `x--` only open a link that a right-hand
 * head has to close — so such a line does not render and carries no edge.
 */
export function isBackArrow(link) {
  const { left, right } = linkHeads(link);
  return Boolean(left) && !right;
}

/** Heads on both sides: `<-->`, `o--o`, `x--x`. Both directions are asserted. */
export function isBidirectional(link) {
  const { left, right } = linkHeads(link);
  return Boolean(left) && Boolean(right);
}

/** Dotted (`-.->`) is presentation: the AST keeps it, the RDF drops it. */
export function isDotted(link) {
  return link.includes('.');
}
