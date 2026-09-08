import { StateField } from '@codemirror/state';
import { parseDocument } from '../parser/document.js';
import { expandDocument } from '../parser/templates.js';

/**
 * Every node and subgraph id declared anywhere in the markdown document, as
 * `Map<id, { id, label, classes, diagrams }>`.
 *
 * `classes` is the union of the d3f: tokens the id carries across all blocks —
 * the same document-wide rule the RDF emitter applies when it builds
 * `taggedIds` (see main.js and docs/adr/0003-diagram-to-trig.md), so the editor
 * never claims a node is untagged when the graph treats it as tagged.
 * `diagrams` lists the titles that declare it, for the completion tooltip.
 *
 * Templates are expanded first, so the ids an instance generates are known here
 * too (docs/adr/0031-architecture-templates.md). That is what makes overriding a
 * member practical: typing `ws-1-` completes the members of that instance, which
 * is the only way to discover ids nobody wrote by hand.
 *
 * Read-only: this reuses the parser, it does not feed it. Nothing here reaches
 * the RDF store or the renderers.
 */
export function collectSymbols(text) {
  const symbols = new Map();

  let diagrams;
  try {
    ({ diagrams } = expandDocument(parseDocument(text).diagrams));
  } catch {
    // Half-typed diagrams are the normal state of an editor; an index that
    // throws would take the whole pane down with it.
    return symbols;
  }

  const record = (id, label, classes, diagramTitle) => {
    if (!id) return;
    let entry = symbols.get(id);
    if (!entry) {
      entry = { id, label: '', classes: [], diagrams: [] };
      symbols.set(id, entry);
    }
    if (!entry.label && label) entry.label = label;
    for (const cls of classes ?? []) {
      if (!entry.classes.includes(cls)) entry.classes.push(cls);
    }
    if (diagramTitle && !entry.diagrams.includes(diagramTitle)) entry.diagrams.push(diagramTitle);
  };

  for (const diagram of diagrams) {
    const title = diagram.title || `#${diagram.index + 1}`;
    for (const node of diagram.ast.nodes) record(node.id, node.label, node.classes, title);
    for (const subgraph of diagram.ast.subgraphs) {
      record(subgraph.id, subgraph.label, subgraph.classes, title);
    }
  }

  return symbols;
}

/** Holds the symbol index for the pane; recomputed once per document change. */
export const documentSymbols = StateField.define({
  create: (state) => collectSymbols(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? collectSymbols(tr.state.doc.toString()) : value),
});

/** Symbol index for `state`, or an empty map if the field isn't installed. */
export const getSymbols = (state) => state.field(documentSymbols, false) ?? new Map();
