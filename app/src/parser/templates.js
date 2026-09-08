/**
 * Architecture template expansion (docs/adr/0031-architecture-templates.md).
 *
 * A template is a mermaid block that declares `kind: template` and names its
 * `root:` member. A node referencing it — `ws-1[Web Server 1 T:HostTemplate]` —
 * expands into one resource per member, ids prefixed with the instance's, with
 * the template's own relations and containment reproduced between them.
 *
 * Expansion is a *source rewrite*, not an AST transform: it replaces the line
 * that declares the instance with the mermaid that instance stands for, and the
 * result goes back through `parseDiagram` like any other block. That is what
 * lets the mermaid preview render an expanded instance — the alternative, an
 * AST→AST pass, would leave the preview showing one box and the graph showing
 * many nodes. Nothing is written to the document: the expanded source is derived,
 * so editing a template still reaches every instance.
 *
 * What mermaid cannot carry comes back separately. Membership has no mermaid
 * spelling — an edge label needs a prefix in TYPING_PREFIXES, and the only
 * grouping device is `subgraph`, which means `d3f:contains` — so `expandDocument`
 * returns a provenance record per diagram for the emitter to write instead.
 */

import { TEMPLATE_PREFIX } from '../rdf/emit.js';
import { parseDiagram } from './index.js';
import { tokenizeLine } from './tokenizer.js';
import { parseNodeStatement, extractLabelTokens } from './nodeParser.js';

/** Frontmatter `kind:` value that makes a block a template rather than a diagram. */
export const TEMPLATE_KIND = 'template';

/** How a member's id is joined to its instance's. Must keep ID_RE satisfied. */
const ID_SEPARATOR = '-';

/** Cheap "is there anything to do here?" test, before any line-by-line work. */
const REFERENCE_HINT = new RegExp(`(?<![\\w:])${TEMPLATE_PREFIX}:`);

/** True for a parsed diagram that declares itself a template. */
export function isTemplateBlock(ast) {
  return ast?.frontmatter?.kind === TEMPLATE_KIND;
}

/**
 * Indexes the template blocks of a document by their frontmatter `id:`.
 *
 * A template with no `id:` cannot be referenced, and two templates sharing one
 * `id:` would make a reference ambiguous; both are reported rather than guessed.
 */
export function templateRegistry(diagrams) {
  const templates = new Map();
  const warnings = [];
  for (const d of diagrams) {
    if (!isTemplateBlock(d.ast)) continue;
    const id = d.ast.frontmatter.id;
    if (!id) {
      warnings.push(`Diagram #${d.index + 1} declares kind: template but has no id: to reference it by.`);
      continue;
    }
    if (templates.has(id)) {
      warnings.push(`Duplicate template id "${id}": a reference to it is ambiguous, so it is not expanded.`);
      continue;
    }
    const root = d.ast.frontmatter.root;
    if (!root) {
      warnings.push(`Template "${id}" has no root: — the member a reference to it becomes.`);
      continue;
    }
    const members = memberIds(d.ast);
    if (!members.has(root)) {
      warnings.push(`Template "${id}" names root "${root}", which it does not declare.`);
      continue;
    }
    templates.set(id, { id, root, ast: d.ast });
  }
  return { templates, warnings };
}

/** Every id a template block declares, as nodes or as subgraphs. */
function memberIds(ast) {
  return new Set([...ast.nodes.map((n) => n.id), ...ast.subgraphs.map((s) => s.id)]);
}

/** The declaration of `id` in a template — its subgraph form wins, as in the emitter. */
function memberOf(ast, id) {
  const subgraph = ast.subgraphs.find((s) => s.id === id);
  const node = ast.nodes.find((n) => n.id === id);
  return {
    node,
    subgraph,
    classes: [...new Set([...(subgraph?.classes || []), ...(node?.classes || [])])],
    // A subgraph with no title is labelled with its own id by the parser, which
    // is a display fallback and not something to copy into every instance.
    label: subgraph ? (subgraph.label === id ? '' : subgraph.label) : node?.label || '',
    templates: node?.templates || [],
    shared: !!(subgraph?.shared || node?.shared),
    isContainer: !!subgraph,
  };
}

/** Renders a label and its class tokens back into mermaid shape content. */
function shapeContent(label, classes) {
  const text = [label, ...classes].filter(Boolean).join(' ');
  // A label carrying mermaid's own punctuation has to be quoted to survive a
  // round trip; the parser strips the quotes again (`stripQuotes`).
  return /["[\]{}()|]/.test(label) ? `"${text.replace(/"/g, "'")}"` : text;
}

/**
 * Expands one template reference into mermaid lines.
 *
 * `rename` maps a template-local id to the id it takes in this instance: the
 * root becomes the instance itself, a shared member keeps its own id — one
 * resource every instance points at — and everything else is prefixed. Cloning
 * is the default and sharing is the marked case on purpose: a forgotten marker
 * then yields a visible duplicate, where the other polarity would have every
 * instance silently sharing one address.
 */
function instanceLines(template, instanceId, instanceLabel, registry, indent, seen, out) {
  const { ast, root } = template;
  const declared = memberIds(ast);
  const rename = (id) => {
    if (!declared.has(id)) return id;
    if (id === root) return instanceId;
    if (memberOf(ast, id).shared) return id;
    return `${instanceId}${ID_SEPARATOR}${id}`;
  };

  out.instances.push({ id: instanceId, templateId: template.id });

  // A subgraph declaration wins over a bare node occurrence of the same id,
  // except when only the occurrence knows the parent — the same rule the
  // emitter's `declaredParent` follows, so the copy nests as the original did.
  const childrenOf = new Map();
  for (const id of declared) {
    const asSubgraph = ast.subgraphs.find((s) => s.id === id);
    const asNode = ast.nodes.find((n) => n.id === id);
    const parent = asSubgraph?.parent ?? asNode?.parent;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(id);
  }

  const lines = [];
  const emitMember = (id, depth) => {
    const member = memberOf(ast, id);
    const renamed = rename(id);
    const pad = '  '.repeat(depth);
    // A member is a member of the instance, not of the document: shared members
    // belong to no one instance, and the root *is* the instance.
    if (!member.shared && id !== root) {
      out.members.push({ id: renamed, instanceId });
    }
    // A member that references a template is itself an instance. `seen` is the
    // chain of templates being expanded, so a template that reaches itself is
    // stopped here rather than expanding forever.
    const nested = member.templates[0];
    if (nested) {
      if (seen.includes(nested)) {
        out.warnings.push(
          `Template "${template.id}" instantiates "${nested}", which is already being ` +
            `expanded (${[...seen, nested].join(' → ')}): the reference is skipped.`,
        );
      } else if (!registry.has(nested)) {
        out.warnings.push(`Unknown template "T:${nested}" referenced by template "${template.id}".`);
      } else {
        lines.push(
          ...instanceLines(
            registry.get(nested),
            renamed,
            member.label,
            registry,
            // The nested block's own lines are indented to this member's depth;
            // `indent` is prose, not a count, and the outer call adds its own.
            pad,
            [...seen, nested],
            out,
          ),
        );
        return;
      }
    }
    const label = id === root ? instanceLabel : member.label;
    const content = shapeContent(label, member.classes);
    if (member.isContainer) {
      lines.push(`${pad}subgraph ${renamed}${content ? `[${content}]` : ''}`);
      for (const child of childrenOf.get(id) || []) emitMember(child, depth + 1);
      lines.push(`${pad}end`);
    } else {
      lines.push(content ? `${pad}${renamed}[${content}]` : `${pad}${renamed}`);
    }
  };

  // Members outside the root first, then the root and what it contains, so the
  // block reads the way the template was written.
  const topLevel = childrenOf.get(undefined) || [];
  for (const id of topLevel) if (id !== root) emitMember(id, 0);
  if (topLevel.includes(root)) emitMember(root, 0);

  for (const edge of ast.edges) {
    const arrow = edge.dotted ? '-.->' : '-->';
    lines.push(`${rename(edge.from)} ${arrow}|${edge.predicate}| ${rename(edge.to)}`);
  }

  return lines.map((line) => (line ? indent + line : line));
}

/**
 * Rewrites one block's source, replacing every line that declares a template
 * instance with the mermaid that instance stands for.
 *
 * Returns null when the block references no template, so a document without
 * templates is handed on untouched and pays nothing.
 */
function expandSource(source, registry, out) {
  // One scan before any line work. This is the fast path for the documents that
  // have nothing to do with templates, which is most of them, and it is cheaper
  // than asking whether the document declares any: a block referencing a
  // template that does not exist has to be reported, not skipped.
  if (!REFERENCE_HINT.test(source)) return null;

  const lines = source.split(/\r?\n/);
  const rewritten = [];
  let expandedAny = false;

  for (const rawLine of lines) {
    const token = tokenizeLine(rawLine);
    if (!token || token.type !== 'node') {
      rewritten.push(rawLine);
      continue;
    }
    const parsed = parseNodeStatement(token.line);
    if (!parsed) {
      rewritten.push(rawLine);
      continue;
    }
    // `parseNodeStatement` already resolves the `@{label: …}` form into
    // shapeContent, so this is the one place the reference can be written.
    const { templates: referenced, label } = extractLabelTokens(parsed.shapeContent);
    if (!referenced.length) {
      rewritten.push(rawLine);
      continue;
    }
    const templateId = referenced[0];
    if (!registry.has(templateId)) {
      out.warnings.push(
        `Unknown template "T:${templateId}" on node "${parsed.id}": no block declares ` +
          `kind: template with id: ${templateId}.`,
      );
      rewritten.push(rawLine);
      continue;
    }
    const indent = /^\s*/.exec(rawLine)[0];
    rewritten.push(
      ...instanceLines(registry.get(templateId), parsed.id, label, registry, indent, [templateId], out),
    );
    expandedAny = true;
  }

  return expandedAny ? rewritten.join('\n') : null;
}

/**
 * Expands every template reference in a parsed document.
 *
 * Returns the diagrams with, for each one that instantiated something, an
 * `expandedSource` (what the preview renders and what `ast` was re-parsed from)
 * and a `provenance` record for the emitter. Template blocks are marked
 * `isTemplate` and keep their own ast: they are declarations, so they contribute
 * no resources of their own to the document.
 */
export function expandDocument(diagrams) {
  const { templates, warnings } = templateRegistry(diagrams);

  const expanded = diagrams.map((d) => {
    if (isTemplateBlock(d.ast)) return { ...d, isTemplate: true };

    const out = { instances: [], members: [], warnings: [] };
    const expandedSource = expandSource(d.source, templates, out);
    if (!expandedSource) {
      warnings.push(...out.warnings);
      return d;
    }
    warnings.push(...out.warnings);
    // The expanded ast replaces the original outright, warnings included. The
    // rewrite only ever replaced template-reference lines, so re-parsing repeats
    // every other complaint the original made — and drops the one it should:
    // a block whose only node is a reference has no class annotations *until*
    // it is expanded.
    const ast = parseDiagram(expandedSource);
    return {
      ...d,
      expandedSource,
      ast,
      provenance: { instances: out.instances, members: out.members },
    };
  });

  return { diagrams: expanded, warnings };
}
