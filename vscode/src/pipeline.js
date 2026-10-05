/**
 * One document model per markdown document, and nothing from the VS Code API, so a
 * plain vitest run covers it (docs/adr/0043-vscode-extension.md). The host feeds it
 * the document text and posts the result to the webviews.
 */

import { createDocumentModel } from '../../app/src/rdf/documentModel.js';
import { fromFlatContribution, toFlatContribution } from './flat.js';

export function createPipeline({ enrichmentTurtle }) {
  const models = new Map();

  function modelFor(key) {
    if (!models.has(key)) models.set(key, createDocumentModel({ enrichmentTurtle }));
    return models.get(key);
  }

  const known = (model) => [...model.knownGraphNames()];

  return {
    /** Re-parses `text`. The warnings are the parser's; the view adds its own. */
    update(key, text) {
      const model = modelFor(key);
      const { warnings } = model.setText(text);
      return {
        warnings,
        contributions: model.contributions().map(toFlatContribution),
        knownGraphNames: known(model),
      };
    },

    /** The whole document as TriG, from the contributions last `update`d or added. */
    trig: (key) => modelFor(key).toTrig(),

    /** A graph the user added in the webview; returns the names a text change may drop. */
    addGraph(key, flatContribution, { sweepable = false } = {}) {
      const model = modelFor(key);
      model.add(fromFlatContribution(flatContribution), { sweepable });
      return known(model);
    },

    removeGraph(key, name) {
      const model = modelFor(key);
      model.remove(name);
      return known(model);
    },

    dispose: (key) => models.delete(key),
  };
}
