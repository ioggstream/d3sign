import { TYPING_PREFIXES } from '../rdf/emit.js';

/**
 * A class token in any vocabulary a diagram may write — `d3f:Password`,
 * `dpv:PersonalData`, `pd:MedicalHealth`, `eu-gdpr:DataSubject`.
 *
 * The prefix set is TYPING_PREFIXES, deliberately narrower than the set the editor
 * hovers over: a prefix here is consumed *anywhere* in a node label, so admitting
 * `risk:` would silently strip the label off `A[Cache risk:high]`. Longest prefix
 * first, because a regex alternation is first-match and a shorter prefix that is a
 * suffix of a longer one would truncate the token. `(?<![\w:])` keeps a prefix from
 * firing inside a longer identifier or a hand-written IRI, and — since `-` is not a
 * word character — is also why `gdpr:` must not be registered beside `eu-gdpr:`.
 *
 * A dotted segment is part of the token when it contains a digit, because that is
 * what D3FEND's dotted local names are: ATT&CK ids, either a sub-technique
 * (`d3f:T1548.001`) or an ATLAS tactic (`d3f:AML.TA0000`) — all 497 of them match,
 * and reading one as `d3f:T1548` plus a stray `.001` label types the node as the
 * parent technique instead. The digit is what keeps prose out: a label may end a
 * sentence on a class (`d3f:Email.`) or run one into the next word
 * (`d3f:User.Then`), and neither is a class name. That rule is why this is not
 * `termTokenPattern()` from editor/vocabularies.js, whose `[\w.-]+` local name
 * swallows both — hover wants the longest plausible token, the parser the exact one.
 */
const CLASS_TOKEN_RE = new RegExp(
  `(?<![\\w:])(?:${TYPING_PREFIXES.slice()
    .sort((a, b) => b.length - a.length)
    .join('|')}):[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]*[0-9][A-Za-z0-9-]*)*`,
  'g',
);

/**
 * Extracts class tokens and the remaining free-text label from a chunk of text
 * (a node's shape content, a subgraph title, or a label attr).
 */
export function extractLabelTokens(text) {
  if (!text) return { classes: [], label: '' };
  const classes = [...text.matchAll(CLASS_TOKEN_RE)].map((m) => m[0]);
  const label = text
    .replace(CLASS_TOKEN_RE, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { classes, label };
}

function stripQuotes(s) {
  const trimmed = s.trim();
  const match = /^"(.*)"$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

/** Parses a simple `key: "value", key2: value2` attribute list from `@{...}`. */
export function parseAttrs(attrString) {
  const attrs = {};
  if (!attrString) return attrs;
  // Split on commas that are not inside quotes.
  const parts = attrString.match(/(?:[^,"]|"[^"]*")+/g) || [];
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = stripQuotes(part.slice(idx + 1));
    if (key) attrs[key] = value;
  }
  return attrs;
}

export const ID_RE = '[A-Za-z0-9_-]+';
const ATTRS_SUFFIX = '(?:@\\{([\\s\\S]*)\\})?\\s*$';
const SHAPE_PATTERNS = [
  new RegExp(`^(${ID_RE})\\(\\((.*)\\)\\)${ATTRS_SUFFIX}`), // circle: ((label))
  new RegExp(`^(${ID_RE})\\[\\[(.*)\\]\\]${ATTRS_SUFFIX}`), // subroutine: [[label]]
  new RegExp(`^(${ID_RE})\\[\\((.*)\\)\\]${ATTRS_SUFFIX}`), // cylinder: [(label)]
  new RegExp(`^(${ID_RE})\\(\\[(.*)\\]\\)${ATTRS_SUFFIX}`), // stadium: ([label])
  new RegExp(`^(${ID_RE})\\{\\{(.*)\\}\\}${ATTRS_SUFFIX}`), // hexagon: {{label}}
  new RegExp(`^(${ID_RE})\\{(.*)\\}${ATTRS_SUFFIX}`), // rhombus: {label}
  new RegExp(`^(${ID_RE})\\[/(.*)/\\]${ATTRS_SUFFIX}`), // parallelogram: [/label/]
  new RegExp(`^(${ID_RE})\\[\\\\(.*)\\\\\\]${ATTRS_SUFFIX}`), // parallelogram alt: [\label\]
  new RegExp(`^(${ID_RE})\\[/(.*)\\\\\\]${ATTRS_SUFFIX}`), // trapezoid: [/label\]
  new RegExp(`^(${ID_RE})\\[\\\\(.*)/\\]${ATTRS_SUFFIX}`), // trapezoid alt: [\label/]
  new RegExp(`^(${ID_RE})>(.*)\\]${ATTRS_SUFFIX}`), // asymmetric/flag: >label]
  new RegExp(`^(${ID_RE})\\[(.*)\\]${ATTRS_SUFFIX}`), // rect: [label]
  new RegExp(`^(${ID_RE})\\((.*)\\)${ATTRS_SUFFIX}`), // round: (label)
];
const ATTRS_ONLY_RE = new RegExp(`^(${ID_RE})@\\{([\\s\\S]*)\\}\\s*$`);
const BARE_ID_RE = new RegExp(`^(${ID_RE})\\s*$`);

/**
 * Parses a single node-declaration statement (already isolated from the
 * surrounding mermaid line) into { id, shapeContent, attrs } or null if the
 * line doesn't look like a node declaration.
 */
export function parseNodeStatement(statement) {
  const line = statement.trim();
  if (!line) return null;

  const attrsOnly = ATTRS_ONLY_RE.exec(line);
  if (attrsOnly) {
    const [, id, attrString] = attrsOnly;
    const attrs = parseAttrs(attrString);
    return { id, shapeContent: attrs.label || '', attrs };
  }

  for (const re of SHAPE_PATTERNS) {
    const match = re.exec(line);
    if (match) {
      const [, id, rawShapeContent, attrString] = match;
      return {
        id,
        shapeContent: stripQuotes(rawShapeContent),
        attrs: parseAttrs(attrString),
      };
    }
  }

  const bareId = BARE_ID_RE.exec(line);
  if (bareId) {
    return { id: bareId[1], shapeContent: '', attrs: {} };
  }

  return null;
}
