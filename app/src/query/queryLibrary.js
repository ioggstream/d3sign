/**
 * The canned query library.
 *
 * Loaded the way the example diagrams are (see `main.js`) — an eager `?raw` glob,
 * so the picker is populated at build time and a new query is a new file and
 * nothing else. The numeric filename prefixes are the ordering.
 *
 * "Run specific queries on artifacts" is the actual goal here; hand-writing SPARQL
 * over D3FEND is the fallback, not the feature.
 */

import { parseQueryDoc } from './resultModel.js';

const files = import.meta.glob('../data/queries/*.rq', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function fileNameOf(path) {
  return path.split('/').pop();
}

export const QUERY_LIBRARY = Object.keys(files)
  .sort()
  .map((path) => {
    const fileName = fileNameOf(path);
    return { fileName, ...parseQueryDoc(files[path], fileName) };
  });

export function queryByFileName(fileName) {
  return QUERY_LIBRARY.find((entry) => entry.fileName === fileName) || null;
}
