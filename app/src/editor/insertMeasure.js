import { ID_RE } from '../parser/nodeParser.js';
import { collectSourceLocations, sourceLocationsFor } from './sourceLocations.js';
import d3fendMetadata from '../data/d3fend-metadata.json';

/**
 * Writing a D3FEND relation into the mermaid source.
 *
 * The node panel lists the relations the ontology already knows about — a
 * defensive measure, an attack, or a plain restriction such as
 * `User d3f:has-account UserAccount`; this is what turns one of them into three
 * lines of diagram. The rule is the same for all three, and which rows offer it
 * is the panel's decision, not this module's. It is a text function, not an
 * editor one: it takes the document and returns a single change, so the same
 * rules can be asserted without CodeMirror or a DOM (see the editor pane's
 * `addRelation`, which is the only caller).
 *
 * The anchor is found the same way a jump to the source is found — by scanning
 * the live text at call time (docs/adr/0017-go-to-mermaid-source.md). Nothing
 * here reads the RDF store, so the insertion point can never be stale.
 */

const LEADING_ID_RE = new RegExp(`^${ID_RE}`);

/**
 * The comment every addition is written under, so a reader of the document can
 * tell what they typed from what the panel wrote — and delete it by the comment.
 *
 * Exported rather than inlined because the tests assert on it and a future "find
 * my additions" would have to spell it the same way. Costs nothing in RDF: the
 * tokenizer strips `%%` to end of line, so a comment-only line produces neither a
 * quad nor a source location.
 */
export const ADDED_MARKER = '%% Added via UI';

/** The id an id-like token stands for, e.g. `B[Label]` as an edge endpoint → `B`. */
function leadingToken(id) {
  const match = LEADING_ID_RE.exec(id);
  return match ? match[0] : id;
}

/**
 * A mermaid id for a D3FEND class: its local name lowercased, restricted to the
 * parser's id charset — a `.` becomes `_`, because the dots in ATT&CK ids carry
 * the hierarchy and `t1110_001` still reads as `T1110.001` where `t1110001` does
 * not — then suffixed `2`, `3`, … until it is free.
 */
export function relationNodeId(localName, taken = new Set()) {
  const base =
    String(localName)
      .toLowerCase()
      .replace(/\./g, '_')
      .replace(/[^a-z0-9_-]/g, '') || 'node';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/**
 * The shape content for the added node: the class, then the D3FEND label of that
 * class so the drawing names it in words. Without the label an ATT&CK node reads
 * `t1110_001` and nothing else — the id is the technique number, which is exactly
 * the thing the reader needed translating.
 *
 * The label is written as mermaid can take it: the characters that would close the
 * shape or open another one are dropped, and parentheses — common in D3FEND labels
 * — force the whole content into quotes, which the node parser strips back off.
 */
export function relationNodeContent(localName) {
  const curie = `d3f:${localName}`;
  const label = (d3fendMetadata[localName]?.label ?? '')
    .replace(/[[\]{}|"<>]/g, '')
    .replace(/%%/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A label that only repeats the local name adds nothing to the CURIE beside it.
  if (!label || label === localName) return curie;
  const content = `${curie} ${label}`;
  return /[()]/.test(content) ? `"${content}"` : content;
}

/** Offset of the end of each 1-based line, so a line number becomes a position. */
function lineEnds(text) {
  const ends = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    ends.push(offset + line.length);
    offset += line.length + 1;
  }
  return ends;
}

/**
 * The change that adds `rel` — a `relations` entry of d3fend-metadata.json, of
 * any `kind` — to the node written as `anchorId`: the marker comment, a
 * declaration for the other end (its class and D3FEND label), and the link that
 * ties it to the anchor, on the three lines below the anchor's own declaration and
 * at its indentation.
 *
 * `{ from, insert }` as CodeMirror wants it, or null when the anchor is not
 * written in any mermaid block of `text`.
 */
export function relationInsertion(text, anchorId, rel) {
  if (!anchorId || !rel?.targetLocalName || !rel?.predicate) return null;

  const index = collectSourceLocations(text);
  // Declarations sort ahead of mentions, so an anchor that is both declared and
  // used on an edge gets the measure next to its declaration.
  const [location] = sourceLocationsFor(index, anchorId);
  if (!location) return null;

  const taken = new Set([...index.nodes.keys()].map(leadingToken));
  const id = relationNodeId(rel.targetLocalName, taken);

  const raw = text.split('\n')[location.line - 1] ?? '';
  const indent = /^\s*/.exec(raw)[0];

  // `direction` is read from the anchor's side: 'in' is something acting on it.
  const [from, to] = rel.direction === 'in' ? [id, anchorId] : [anchorId, id];
  const lines = [
    `${indent}${ADDED_MARKER}`,
    `${indent}${id}[${relationNodeContent(rel.targetLocalName)}]`,
    `${indent}${from} -->|${rel.predicate}| ${to}`,
  ];

  return { from: lineEnds(text)[location.line - 1], insert: `\n${lines.join('\n')}` };
}
