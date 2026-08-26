import { parseDiagram } from './index.js';

/** Extracts every ```mermaid fenced block from a markdown document, in order. */
export function extractMermaidBlocks(markdown) {
  const re = /```mermaid\r?\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = re.exec(markdown))) {
    blocks.push({ index: blocks.length, source: match[1] });
  }
  return blocks;
}

/** Deterministic short hash of a title, used only as a stable UI/DOM key. */
export function titleHash(title) {
  const normalized = title.trim();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 33) ^ normalized.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Parses every mermaid diagram in a markdown document into a list of
 * `{ index, source, ast, title, hash, diagramId }`, plus document-level
 * warnings (missing/duplicate titles). Each diagram's `ast` still comes from
 * `parseDiagram` (single-block parser); `diagramId` is the RDF named-graph
 * key (frontmatter `id:`, unchanged fallback behavior) and is independent of
 * `hash`, which is only a UI selection key derived from the title.
 */
const IDENTIFIER_RE = /^[A-Za-z][\w-]*$/;

export function parseDocument(markdown, { defaultDiagramId = 'current' } = {}) {
  const blocks = extractMermaidBlocks(markdown);
  const warnings = [];
  const titleCounts = new Map();

  const diagrams = blocks.map(({ index, source }) => {
    const ast = parseDiagram(source);
    const title = (ast.frontmatter.title || '').trim();
    if (!title) {
      warnings.push(`Diagram #${index + 1} is missing a required title`);
    } else {
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    const diagramId = ast.frontmatter.id || defaultDiagramId;
    if (!IDENTIFIER_RE.test(diagramId)) {
      warnings.push(`Diagram id "${diagramId}" is not a valid identifier (RDF graph names must be identifiers)`);
    }
    return { index, source, ast, title, diagramId };
  });

  for (const [title, count] of titleCounts) {
    if (count > 1) warnings.push(`Duplicate diagram title: "${title}"`);
  }

  const diagramsWithHash = diagrams.map((d) => ({
    ...d,
    hash: titleHash(d.title || `#${d.index + 1}`),
  }));

  return { diagrams: diagramsWithHash, warnings };
}
