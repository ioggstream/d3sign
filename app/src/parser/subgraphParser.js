const SUBGRAPH_OPEN_RE = /^subgraph\s+([A-Za-z0-9_&-]+)\s*(?:\[(.*)\])?\s*$/;
const SUBGRAPH_END_RE = /^end\s*$/;

export function parseSubgraphOpen(line) {
  const match = SUBGRAPH_OPEN_RE.exec(line.trim());
  if (!match) return null;
  const [, id, rawTitle] = match;
  let title = rawTitle;
  if (title) {
    const quoted = /^"(.*)"$/.exec(title.trim());
    title = quoted ? quoted[1] : title.trim();
  }
  return { id: id.replace(/^&/, ''), title: title || '' };
}

export function isSubgraphEnd(line) {
  return SUBGRAPH_END_RE.test(line.trim());
}
