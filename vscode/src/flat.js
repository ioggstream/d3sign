/**
 * A contribution as it crosses `postMessage`: n3 quads do not survive structured
 * cloning, so they travel as plain objects (docs/adr/0043-vscode-extension.md).
 * Shared by the extension host and the webview.
 */

import { flatFromQuads, quadsFromFlat } from '../../app/src/query/flatQuads.js';

export function toFlatContribution(contribution) {
  return { ...contribution, quads: flatFromQuads(contribution.quads) };
}

/** A contribution's quads all live in the graph that carries its name. */
export function fromFlatContribution(flat) {
  return { ...flat, quads: quadsFromFlat(flat.quads, flat.name) };
}
