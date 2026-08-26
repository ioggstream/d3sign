import { PREFIXES } from '../rdf/emit.js';
import { ADDED_MARKER } from '../editor/insertMeasure.js';
import { shortLabel } from '../rdf/graphModel.js';
import { termOf } from '../editor/vocabularies.js';
import d3fendMetadata from '../data/d3fend-metadata.json';
import alignment from '../data/alignment.json';

const DEFINITION_TRUNCATE_LENGTH = 120;

function d3fClassLocalNames(quads) {
  return quads
    .filter((q) => q.predicate.value === PREFIXES.rdf + 'type' && q.object.value.startsWith(PREFIXES.d3f))
    .map((q) => q.object.value.slice(PREFIXES.d3f.length));
}

/**
 * The node's types as qnames, in every vocabulary — `d3f:Password`,
 * `dpv:PersonalData`, `pd:MedicalHealth`.
 *
 * `d3fClassLocalNames` above stays `d3f:`-only on purpose: it feeds
 * d3fend-metadata.json, which is keyed by bare D3FEND local name and knows nothing
 * else. This is what the vocabulary-agnostic parts of the panel read instead.
 */
function typeQnames(quads) {
  return quads
    .filter((q) => q.predicate.value === PREFIXES.rdf + 'type')
    .map((q) => shortLabel(q.object.value));
}

/**
 * Appends `definition` as a paragraph, folded behind "Show more" past
 * DEFINITION_TRUNCATE_LENGTH.
 *
 * Exported for the edge panel (viz/edgePanel.js): a predicate's definition is as
 * long as a class's and must fold the same way, and two copies of this would
 * drift apart on the first tweak.
 */
export function renderDefinition(definition, host) {
  const p = document.createElement('p');
  if (definition.length <= DEFINITION_TRUNCATE_LENGTH) {
    p.textContent = definition;
    host.appendChild(p);
    return;
  }

  const shortText = document.createElement('span');
  shortText.textContent = `${definition.slice(0, DEFINITION_TRUNCATE_LENGTH)}…`;
  const fullText = document.createElement('span');
  fullText.textContent = definition;
  fullText.hidden = true;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'node-panel-more';
  toggle.textContent = 'Show more';
  toggle.title = 'Show the whole D3FEND definition';
  toggle.addEventListener('click', () => {
    const expanded = !fullText.hidden;
    shortText.hidden = !expanded;
    fullText.hidden = expanded;
    toggle.textContent = expanded ? 'Show more' : 'Show less';
    toggle.title = expanded ? 'Show the whole D3FEND definition' : 'Fold the definition back to its first line';
  });

  p.appendChild(shortText);
  p.appendChild(fullText);
  p.appendChild(document.createTextNode(' '));
  p.appendChild(toggle);
  host.appendChild(p);
}

function resolveLabel(localName) {
  return d3fendMetadata[localName]?.label || localName;
}

// ATT&CK sub-technique ids encode their hierarchy in the id itself, e.g.
// "T1548.001" is a sub-technique of "T1548".
const ATTACK_ID_RE = /^T\d+(?:\.\d+)*$/;

function attackHierarchy(localName) {
  if (!ATTACK_ID_RE.test(localName)) return [];
  const segments = localName.split('.');
  const ancestors = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('.'));
  }
  return ancestors.map((id) => `${resolveLabel(id)} (${id})`);
}

function chipTooltip(localName) {
  const entry = d3fendMetadata[localName];
  const lines = [];
  if (entry?.definition) lines.push(entry.definition);
  const hierarchy = attackHierarchy(localName);
  if (hierarchy.length) lines.push(`Hierarchy: ${[...hierarchy, resolveLabel(localName)].join(' > ')}`);
  return lines.join('\n\n');
}

function makeChip(localName, className) {
  const chip = document.createElement('span');
  chip.className = className;
  chip.textContent = `${resolveLabel(localName)} (${localName})`;
  const tooltip = chipTooltip(localName);
  if (tooltip) chip.title = tooltip;
  return chip;
}

/**
 * What the "+" on a row is about to write, as a sentence. A bare "Add to the
 * diagram" names neither end nor the link, which is most of what the reader wants
 * to know before clicking — and every row on screen would say the same thing.
 *
 * Exported for the tests: it is the one part of the button that is not DOM.
 */
export function addButtonTitle(rel) {
  const other = `${resolveLabel(rel.targetLocalName)} (${rel.targetLocalName})`;
  const link =
    rel.direction === 'in'
      ? `link it to this node as "${other} ${rel.predicate} this"`
      : `link it to this node as "this ${rel.predicate} ${other}"`;
  return `Add ${other} to the mermaid diagram and ${link}. The lines go below this node's declaration, under a "${ADDED_MARKER}" comment.`;
}

/**
 * The button that writes the relation into the diagram. It reports what it did
 * in place rather than through a re-render: `renderNodePanel` rebuilds the whole
 * modal, which would close every "Show more" the user had opened.
 */
function renderAddButton(rel, onAdd) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'node-panel-chip-add';
  button.textContent = '+';
  button.title = addButtonTitle(rel);
  button.addEventListener('click', () => {
    if (!onAdd(rel)) return;
    button.disabled = true;
    button.textContent = '✓';
    button.title = `Added below this node in the mermaid source, under a "${ADDED_MARKER}" comment — rename or delete it there.`;
  });
  return button;
}

function renderRelationChip(rel, host, onAdd) {
  const li = document.createElement('li');
  li.className = 'node-panel-chip-row';

  const arrow = rel.direction === 'in' ? '→' : '←';

  const sourceChip =
    rel.direction === 'in'
      ? makeChip(rel.targetLocalName, 'node-panel-chip')
      : Object.assign(document.createElement('span'), { className: 'node-panel-chip', textContent: 'this' });

  const predicate = document.createElement('span');
  predicate.className = 'node-panel-chip-predicate';
  predicate.textContent = `${arrow} ${rel.predicate}`;

  const targetChip =
    rel.direction === 'in'
      ? Object.assign(document.createElement('span'), { className: 'node-panel-chip', textContent: 'this' })
      : makeChip(rel.targetLocalName, 'node-panel-chip');

  // The button leads the row rather than trailing it: rows wrap, and a trailing
  // control ends up on a line of its own, away from the relation it acts on.
  if (onAdd) li.appendChild(renderAddButton(rel, onAdd));
  li.appendChild(sourceChip);
  li.appendChild(predicate);
  li.appendChild(targetChip);
  host.appendChild(li);
}

function renderRelationSection(title, relations, host, onAdd) {
  if (!relations.length) return;
  const heading = document.createElement('h4');
  heading.textContent = title;
  host.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'node-panel-chip-list';
  for (const rel of relations) {
    renderRelationChip(rel, list, onAdd);
  }
  host.appendChild(list);
}

/**
 * Splits a class's relations into the panel's three sections.
 *
 * `defense` is only what the metadata build tagged against a
 * d3f:DefensiveTechnique partner; every other relation the ontology states about
 * the class — mostly OWL restrictions such as `User d3f:has-account UserAccount`
 * — is `related`, not a defensive measure. Unknown and missing kinds fall into
 * `related` too, so a metadata file built before that tagging existed still
 * renders every row somewhere.
 *
 * Pure, and exported for the tests: the panel builds DOM, which the suite has no
 * jsdom to inspect.
 */
export function groupRelations(relations = []) {
  return {
    attack: relations.filter((r) => r.kind === 'attack'),
    defense: relations.filter((r) => r.kind === 'defense'),
    related: relations.filter((r) => r.kind !== 'attack' && r.kind !== 'defense'),
  };
}

/**
 * The alignment rows to show for a node, given its types.
 *
 * A `d3f:`-typed node is looked up directly. A node typed only in DPV goes through
 * the reverse index: `dpv:EncryptionAtRest` finds `d3f:DiskEncryption`, whose
 * mappings are the ones that apply. Deduplicated by mapping identity, because two of
 * a node's types can reach the same claim.
 *
 * Pure, and exported for the tests — the suite has no jsdom to inspect DOM with.
 */
export function alignmentRowsFor(typeQnameList) {
  const { byD3fendClass = {}, byLegalConcept = {} } = alignment;
  const classes = new Set();
  for (const qname of typeQnameList) {
    if (byD3fendClass[qname]) classes.add(qname);
    for (const related of byLegalConcept[qname] ?? []) classes.add(related);
  }

  const seen = new Set();
  const rows = [];
  for (const d3fendClass of [...classes].sort()) {
    for (const entry of byD3fendClass[d3fendClass] ?? []) {
      const key = `${d3fendClass}|${entry.obligation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...entry, d3fendClass });
    }
  }
  return rows;
}

/**
 * The Legal section: which statutory duties the node's classes are claimed to speak
 * to, from the precomputed projection of regulation.ttl's al:Mapping subjects.
 *
 * Two things this must not do, both from docs/adr/0025-legal-knowledge-bases.md.
 * It must not read as a compliance finding: coverage is a property of a *drawing*,
 * and says nothing about whether a control is configured, deployed, effective or in
 * scope — hence the caption and the review-status badge on every row. And it must not
 * write: materialising obligations into the graph stays the user-driven CONSTRUCT in
 * data/queries/13-enrich-legal-obligations.rq, so a duty never appears both as text
 * here and as a drawn node.
 */
function renderLegalSection(rows, host) {
  if (!rows.length) return;

  const heading = document.createElement('h4');
  heading.textContent = 'Legal';
  host.appendChild(heading);

  const caption = document.createElement('p');
  caption.className = 'node-panel-caption';
  caption.textContent =
    'Engineering judgement, not legal advice: that this technique speaks to a duty ' +
    'says nothing about whether it is configured, deployed, effective or in scope.';
  host.appendChild(caption);

  const list = document.createElement('ul');
  list.className = 'node-panel-chip-list';
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'node-panel-chip-row';

    const status = document.createElement('span');
    status.className = 'node-panel-badge node-panel-badge-draft';
    status.textContent = (row.reviewStatus ?? 'unreviewed').toLowerCase();
    status.title =
      row.reviewStatus === 'Reviewed'
        ? 'A human has read the rationale and agreed with it'
        : 'Proposed, not yet agreed by a reviewer';
    li.appendChild(status);

    const duty = document.createElement('span');
    duty.className = 'node-panel-chip';
    duty.textContent = row.source || row.obligation;
    duty.title = [row.obligationLabel, row.rationale].filter(Boolean).join('\n\n');
    li.appendChild(duty);

    const strength = document.createElement('span');
    strength.className = 'node-panel-chip-predicate';
    // The class is named because it need not be one of the node's own types: a
    // dpv-only node reaches its mappings through the alignment's other end.
    strength.textContent = `${(row.strength ?? 'unrated').toLowerCase()} · ${row.d3fendClass}`;
    li.appendChild(strength);

    list.appendChild(li);
  }
  host.appendChild(list);
}

/**
 * Sets the info panel's text size, in pixels. Every font size inside the panel is
 * relative to it, so the one property scales the whole modal.
 *
 * Written to the `<dialog>` itself, not to the panel body: the body is rebuilt on
 * every open (`renderPanelFrame` empties it), and the two panels share the one
 * dialog, so this survives both and covers the edge panel as well.
 */
export function applyPanelFontSize(host, size) {
  host.style.setProperty('--node-panel-fs', `${size}px`);
}

/**
 * Renders the node info modal: title, D3FEND metadata (truncated definition,
 * kill-chain, deprecated flag, separate Attack/Defense/Relations sections)
 * looked up from the precomputed d3fend-metadata.json, plus the full list of
 * the node's RDF properties read live from `store` (see ADR-0008).
 *
 * `actions.onAddRelation(rel)` — when given — puts a "+" on every relation row of
 * every section, which writes that relation into the diagram and returns whether
 * it did. The panel is handed the callback rather than the editor: the view is not allowed
 * to know mermaid exists (docs/adr/0014-graph-view-from-rdf-only.md), so the
 * shell is what connects the two (docs/adr/0018-add-defensive-measure.md).
 */
export function renderNodePanel(host, nodeData, store, actions = {}) {
  renderPanelFrame(host, nodeData.label?.split('\n')[0] || nodeData.id);

  const quads = store.getSubjectQuads(nodeData.id);
  const classNames = d3fClassLocalNames(quads);
  const metadataEntries = classNames.map((name) => d3fendMetadata[name]).filter(Boolean);
  const qnames = typeQnames(quads);

  // A type in a vocabulary d3fend-metadata.json does not cover gets its definition
  // from the term projection instead — the same text the editor's hover card shows.
  // Without this a `dpv:`-only node's panel was a bare RDF table: the definition, the
  // one thing the panel exists to show, was silently absent because every lookup
  // filtered on the d3f: namespace first.
  const alreadyShown = new Set(
    classNames.filter((name) => d3fendMetadata[name]).map((name) => `d3f:${name}`),
  );
  for (const qname of qnames) {
    if (alreadyShown.has(qname)) continue;
    const term = termOf(qname);
    if (!term?.documentation) continue;

    const section = document.createElement('div');
    section.className = 'node-panel-d3fend';
    const heading = document.createElement('h4');
    heading.textContent = `${term.label} (${qname})`;
    section.appendChild(heading);
    renderDefinition(term.documentation, section);
    // The article the term is defined by, dereferenced from dct:source at build time
    // (ADR 0025). Shown here for the same reason the definition is: on a legal node it
    // is what the panel is for, and it links to the text of the law.
    for (const citation of term.sources ?? []) {
      const line = document.createElement('p');
      line.className = 'node-panel-source';
      const label = document.createElement(citation.url ? 'a' : 'span');
      if (citation.url) {
        label.href = citation.url;
        label.target = '_blank';
        label.rel = 'noopener noreferrer';
      }
      label.textContent = citation.label;
      line.append('Source: ', label);
      section.appendChild(line);
    }
    host.appendChild(section);
  }

  for (const entry of metadataEntries) {
    const section = document.createElement('div');
    section.className = 'node-panel-d3fend';

    if (entry.deprecated) {
      const badge = document.createElement('span');
      badge.className = 'node-panel-badge node-panel-badge-deprecated';
      badge.textContent = 'deprecated';
      section.appendChild(badge);
    }

    if (entry.definition) {
      renderDefinition(entry.definition, section);
    }

    if (entry.killChain?.length) {
      const killChain = document.createElement('div');
      for (const tactic of entry.killChain) {
        const badge = document.createElement('span');
        badge.className = 'node-panel-badge';
        badge.textContent = tactic;
        killChain.appendChild(badge);
      }
      section.appendChild(killChain);
    }

    // Every row is addable, not just the defensive ones: an attack the node is
    // subject to and a restriction it already satisfies are both things a threat
    // model draws, and refusing them only means typing the same two lines by hand.
    const { attack, defense, related } = groupRelations(entry.relations);
    renderRelationSection('Attack', attack, section, actions.onAddRelation);
    renderRelationSection('Defense', defense, section, actions.onAddRelation);
    renderRelationSection('Relations', related, section, actions.onAddRelation);

    host.appendChild(section);
  }

  renderLegalSection(alignmentRowsFor(qnames), host);

  const propsHeading = document.createElement('h4');
  propsHeading.textContent = 'All RDF properties';
  host.appendChild(propsHeading);

  const table = document.createElement('table');
  table.className = 'node-panel-props';
  for (const q of quads) {
    const row = document.createElement('tr');
    const predicateCell = document.createElement('td');
    predicateCell.textContent = shortLabel(q.predicate.value);
    const valueCell = document.createElement('td');
    valueCell.textContent = q.object.termType === 'Literal' ? q.object.value : shortLabel(q.object.value);
    row.appendChild(predicateCell);
    row.appendChild(valueCell);
    table.appendChild(row);
  }
  host.appendChild(table);

  if (!host.open) host.showModal();
}

/**
 * Empties `host` and gives it the furniture every info panel has: a close button
 * and a title.
 *
 * Exported because the node and edge panels share one `<dialog>` (index.html), so
 * they have to share the way out of it too — a second close button wired to its own
 * handler is how one of them ends up unclosable.
 */
export function renderPanelFrame(host, titleText) {
  host.innerHTML = '';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'node-panel-close';
  closeButton.textContent = '✕';
  closeButton.title = 'Close this panel and go back to the graph (Esc)';
  closeButton.addEventListener('click', () => closeNodePanel(host));
  host.appendChild(closeButton);

  const title = document.createElement('h3');
  title.textContent = titleText;
  host.appendChild(title);
}

export function closeNodePanel(host) {
  if (host.open) host.close();
  host.innerHTML = '';
}
