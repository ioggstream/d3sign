/**
 * The document as named graphs: text in, contributions out. No DOM, no storage and
 * no Vite-only import, so the SPA and the VS Code extension host both run it
 * (docs/adr/0043-vscode-extension.md).
 *
 * A contribution is one named graph of the document:
 * `{ name, label, description, kind, quads, edgeComments? }`. They come from the
 * mermaid text (`kind: 'diagram'`), from the enrichment file, from a hand-edited
 * TriG pane (`'manual'`), or are added later by the user (`'query'`).
 *
 * What stays outside: which graphs are drawn (the graph view), the TriG pane's
 * dirty state, and every warning about the model rather than the text.
 */

import { parseDocument } from '../parser/document.js';
import { expandDocument } from '../parser/templates.js';
import { collectTaggedIds, emitQuads, curieForGraphName } from './emit.js';
import { loadEnrichmentTurtle, ENRICHMENT_GRAPH } from './enrichment.js';
import { parseTrigText } from './parseTrig.js';
import { toTurtle } from './serialize.js';

/**
 * `enrichmentTurtle` is injected because the SPA reads it through a Vite `?raw`
 * import, which a plain Node host cannot resolve.
 */
export function createDocumentModel({ enrichmentTurtle, defaultDiagramId = 'current' }) {
  let contributions = new Map();
  // The diagram graph names the last text produced, plus the graphs added with
  // `sweepable`. Only these are dropped when the text stops declaring them: a graph
  // minted from a node's neighbourhood outlives an edit, a CONSTRUCT result does not.
  let knownGraphNames = new Set();
  let enrichmentLoaded = false;

  function ensureEnrichment() {
    if (enrichmentLoaded) return;
    contributions.set(ENRICHMENT_GRAPH, {
      name: ENRICHMENT_GRAPH,
      label: curieForGraphName(ENRICHMENT_GRAPH),
      description: 'Enrichment: well-known auth flows',
      kind: 'enrichment',
      quads: loadEnrichmentTurtle(enrichmentTurtle),
    });
    enrichmentLoaded = true;
  }

  return {
    /**
     * Re-parses the text and rebuilds the diagram graphs. Returns the expanded
     * diagrams and every warning the parser, the template expander and the emitter
     * raised.
     */
    setText(text) {
      const { diagrams: parsed, warnings } = parseDocument(text, { defaultDiagramId });
      // Template references are expanded before anything RDF-aware runs: a diagram
      // that instantiates one carries the expanded ast from here on, so the emitter,
      // taggedIds and the preview all see the same nodes
      // (docs/adr/0031-architecture-templates.md).
      const { diagrams, warnings: templateWarnings } = expandDocument(parsed);

      // Every id carrying a class anywhere in the document, in any vocabulary a
      // diagram may write (TYPING_PREFIXES in rdf/emit.js) — see
      // docs/adr/0003-diagram-to-trig.md and `collectTaggedIds` for why it is
      // collected across the document rather than per block.
      const taggedIds = collectTaggedIds(diagrams);

      const nextDiagramGraphNames = new Set();
      const mergedByGraphName = new Map();
      const emitWarnings = [];
      for (const d of diagrams) {
        // A template block is a declaration, not data: its members exist only as the
        // resources its instances generate, so it contributes no graph of its own.
        if (d.isTemplate) continue;
        const {
          quads,
          graphName,
          warnings: linkWarnings,
          edgeComments,
        } = emitQuads(d.ast, d.diagramId, { taggedIds, provenance: d.provenance });
        emitWarnings.push(...linkWarnings);
        nextDiagramGraphNames.add(graphName);
        if (!mergedByGraphName.has(graphName)) {
          mergedByGraphName.set(graphName, { diagramId: null, quads: [], edgeComments: [] });
        }
        const merged = mergedByGraphName.get(graphName);
        merged.diagramId = d.diagramId;
        merged.quads = merged.quads.concat(quads);
        merged.edgeComments = merged.edgeComments.concat(edgeComments);
      }
      for (const [graphName, merged] of mergedByGraphName) {
        contributions.set(graphName, {
          name: graphName,
          label: curieForGraphName(graphName),
          description: merged.diagramId,
          kind: 'diagram',
          quads: merged.quads,
          edgeComments: merged.edgeComments,
        });
      }
      for (const stale of knownGraphNames) {
        if (!nextDiagramGraphNames.has(stale)) contributions.delete(stale);
      }
      knownGraphNames = nextDiagramGraphNames;

      ensureEnrichment();

      return {
        diagrams,
        warnings: [
          ...warnings,
          ...templateWarnings,
          ...diagrams.flatMap((d) => d.ast.warnings),
          ...emitWarnings,
        ],
      };
    },

    contributions: () => [...contributions.values()],
    get: (name) => contributions.get(name),
    knownGraphNames: () => knownGraphNames,

    /** `sweepable` joins the graph to the set a later text change may drop. */
    add(contribution, { sweepable = false } = {}) {
      contributions.set(contribution.name, contribution);
      if (sweepable) knownGraphNames.add(contribution.name);
    },

    remove(name) {
      if (!contributions.delete(name)) return false;
      knownGraphNames.delete(name);
      return true;
    },

    /**
     * Applies hand-edited TriG. The text is the whole document, so the parsed graphs
     * replace the contributions wholesale — a deleted block is a deleted graph.
     * Invalid text changes nothing and returns `{ error }`.
     */
    replaceFromTrig(text) {
      const { graphs, error } = parseTrigText(text);
      if (error) return { error };
      const previous = contributions;
      contributions = new Map();
      for (const [name, quads] of graphs) {
        const before = previous.get(name);
        contributions.set(name, {
          name,
          label: before?.label ?? curieForGraphName(name),
          description: before?.description ?? 'hand-edited RDF',
          kind: before?.kind ?? 'manual',
          quads,
        });
      }
      return {};
    },

    /** Every contribution as TriG — the whole document, whatever is drawn. */
    toTrig() {
      const all = [...contributions.values()];
      return toTurtle(
        all.flatMap((c) => c.quads),
        { edgeComments: all.flatMap((c) => c.edgeComments || []) },
      );
    },
  };
}
