import { splitFrontmatter } from './frontmatter.js';
import { tokenizeBody } from './tokenizer.js';
import { parseNodeStatement, extractLabelTokens } from './nodeParser.js';
import { backArrowSpans, parseEdgeLine } from './edgeParser.js';
import { parseSubgraphOpen } from './subgraphParser.js';
import { isWritablePredicate } from '../rdf/emit.js';

/** Extracts the first ```mermaid fenced block from a markdown document. */
export function extractMermaidBlock(markdown) {
  const match = /```mermaid\r?\n([\s\S]*?)```/.exec(markdown);
  return match ? match[1] : markdown;
}

function getOrCreateNode(nodes, id) {
  if (!nodes.has(id)) {
    nodes.set(id, { id, classes: [], label: '', icon: undefined, shape: undefined, parent: undefined });
  }
  return nodes.get(id);
}

function applyShape(node, shapeContent, attrs) {
  const { classes, label } = extractLabelTokens(shapeContent);
  if (classes.length) node.classes = [...new Set([...node.classes, ...classes])];
  if (label) node.label = label;
  if (attrs.icon) node.icon = attrs.icon;
  if (attrs.shape) node.shape = attrs.shape;
}

/**
 * Parses mermaid+d3fend source text (a full ```mermaid fenced block or its
 * inner body) into an intermediate AST: { frontmatter, nodes, edges, subgraphs }.
 */
export function parseDiagram(source) {
  const mermaidText = source.includes('```mermaid') ? extractMermaidBlock(source) : source;
  const { frontmatter, body } = splitFrontmatter(mermaidText);
  const lines = tokenizeBody(body);

  const nodes = new Map();
  const subgraphs = new Map();
  const edges = [];
  const stack = [];
  const warnings = [];

  for (const { type, line } of lines) {
    if (type === 'subgraph-open') {
      const parsed = parseSubgraphOpen(line);
      const { classes, label } = extractLabelTokens(parsed.title);
      // Re-opening a subgraph adds to it rather than replacing it: `subgraph dc-1`
      // with no title must not wipe the classes a titled declaration gave it.
      const existing = subgraphs.get(parsed.id);
      subgraphs.set(parsed.id, {
        id: parsed.id,
        classes: [...new Set([...(existing?.classes || []), ...classes])],
        label: label || (existing?.label ?? parsed.id),
        parent: existing?.parent ?? stack[stack.length - 1],
      });
      stack.push(parsed.id);
      continue;
    }
    if (type === 'subgraph-end') {
      stack.pop();
      continue;
    }
    if (type === 'edge') {
      // Mermaid has no back arrows, so the line does not render either: say so
      // rather than dropping it silently. The editor paints the same arrows red
      // (editor/linkErrors.js).
      for (const { arrow } of backArrowSpans(line)) {
        // `<--` closes as `<-->`, `o--` as `o--o`, `x--` as `x--x`.
        const closed = arrow + (arrow.startsWith('<') ? '>' : arrow[0]);
        warnings.push(
          `Unsupported back arrow "${arrow}" in "${line}": mermaid draws arrows left to ` +
            `right — write the source first, or point both ways with "${closed}".`,
        );
      }
      const parsedEdges = parseEdgeLine(line);
      // Mermaid places an endpoint in the subgraph where it is first mentioned,
      // an edge line counting as a mention: a node declared at top level and
      // then only wired up inside a subgraph is still drawn inside it.
      const enclosing = stack[stack.length - 1];
      for (const e of parsedEdges) {
        const fromNode = getOrCreateNode(nodes, e.from);
        const toNode = getOrCreateNode(nodes, e.to);
        if (enclosing) {
          if (!fromNode.parent) fromNode.parent = enclosing;
          if (!toNode.parent) toNode.parent = enclosing;
        }
        if (e.fromAttrs) applyShape(fromNode, e.fromAttrs.shapeContent, e.fromAttrs.attrs);
        if (e.toAttrs) applyShape(toNode, e.toAttrs.shapeContent, e.toAttrs.attrs);

        // An unprefixed label is not a predicate. `|accesses|` used to be expanded to
        // `d3f:accesses`, which read as a convenience and was a trap: the same rule
        // turned mta.md's `|a|` and `|subClassOf|` into `d3f:a` and `d3f:subClassOf`,
        // predicates that do not exist, and there is no way to tell a shorthand for a
        // real property from prose someone wrote between the pipes. The endpoints stay —
        // they were mentioned, so they are declared — only the relation is dropped.
        if (!isWritablePredicate(e.predicate)) {
          // Suggest the qualified form only when there is no prefix to argue with:
          // "d3f:risk:causedBy" would be nonsense advice.
          const hint = e.predicate.includes(':')
            ? `"${e.predicate.split(':', 1)[0]}:" is not a vocabulary a diagram may write`
            : `write it as "d3f:${e.predicate}"`;
          warnings.push(
            `Ignored edge label "${e.predicate}" in "${line}": a predicate needs a ` +
              `vocabulary prefix — ${hint}.`,
          );
          continue;
        }
        edges.push({ from: e.from, to: e.to, predicate: e.predicate, dotted: e.dotted });
      }
      continue;
    }
    // node declaration
    const parsed = parseNodeStatement(line);
    if (!parsed) {
      warnings.push(`Unrecognized statement: "${line}"`);
      continue;
    }
    const node = getOrCreateNode(nodes, parsed.id);
    if (stack.length && !node.parent) node.parent = stack[stack.length - 1];
    applyShape(node, parsed.shapeContent, parsed.attrs);
  }

  // The supported convention embeds class tokens in node/subgraph labels — `d3f:` and,
  // since ADR 0028, the other writable vocabularies (see data/examples/). A `dpv:`-only
  // diagram is therefore annotated, which is why this counts `classes` rather than
  // looking for the `d3f:` prefix. Edge predicates alone don't count:
  // data/examples/mta.md uses d3f: edge labels too, but with a different (unsupported)
  // node-typing convention (`:::classDef`, literal `a`/`subClassOf` edge labels) that
  // this parser does not understand.
  const hasNodeAnnotations =
    [...nodes.values()].some((n) => n.classes.length > 0) ||
    [...subgraphs.values()].some((s) => s.classes.length > 0);

  if (!hasNodeAnnotations) {
    warnings.push(
      'No class annotations found on any node — this diagram may use an unsupported syntax.',
    );
  }

  return {
    frontmatter,
    nodes: [...nodes.values()],
    edges,
    subgraphs: [...subgraphs.values()],
    warnings,
  };
}
