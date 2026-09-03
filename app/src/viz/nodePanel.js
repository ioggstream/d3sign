import { PREFIXES } from '../rdf/emit.js';
import { ADDED_MARKER } from '../editor/insertMeasure.js';
import { neighbourClasses } from '../rdf/neighbourGraph.js';
import { shortLabel } from '../rdf/graphModel.js';
import { termOf } from '../editor/vocabularies.js';
import { relationsFor } from '../editor/d3fendRestrictions.js';
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
  // Where the relation is stated, when it is not stated here. The row is
  // otherwise indistinguishable from one D3FEND puts on this class directly,
  // and "because it is Software" is the answer to why it is on screen at all.
  const inherited = rel.via ? ` D3FEND states it on d3f:${rel.via}, above this class.` : '';
  return `Add ${other} to the mermaid diagram and ${link}.${inherited} The lines go below this node's declaration, under a "${ADDED_MARKER}" comment.`;
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

/**
 * One relation, drawn as the triple it is: subject, predicate, object.
 *
 * The arrow is unconditional. The two chips already swap on `direction`, so a
 * glyph that also swapped was the same fact encoded twice — and the two
 * disagreed, leaving an outgoing row reading `this ← d3f:filters NetworkTraffic`,
 * which says the partner acts on this node.
 *
 * Nothing here names the ancestor an inherited relation comes from. It qualifies
 * the *subject* — `via` is the class `this` stands for, not a property of the
 * link — so it is stated once, in the group's heading
 * (docs/adr/0030-inherited-relations-and-alternative-properties.md).
 */
function renderRelationChip(rel, host, onAdd) {
  const li = document.createElement('li');
  li.className = 'node-panel-chip-row';

  const thisChip = () =>
    Object.assign(document.createElement('span'), { className: 'node-panel-chip', textContent: 'this' });

  const sourceChip = rel.direction === 'in' ? makeChip(rel.targetLocalName, 'node-panel-chip') : thisChip();

  const predicate = document.createElement('span');
  predicate.className = 'node-panel-chip-predicate';
  predicate.textContent = `→ ${rel.predicate}`;

  const targetChip = rel.direction === 'in' ? thisChip() : makeChip(rel.targetLocalName, 'node-panel-chip');

  // The button leads the row rather than trailing it: rows wrap, and a trailing
  // control ends up on a line of its own, away from the relation it acts on.
  if (onAdd) li.appendChild(renderAddButton(rel, onAdd));
  li.appendChild(sourceChip);
  li.appendChild(predicate);
  li.appendChild(targetChip);
  host.appendChild(li);
}

/** A `<ul>` of relation rows. */
function relationList(relations, onAdd) {
  const list = document.createElement('ul');
  list.className = 'node-panel-chip-list';
  for (const rel of relations) {
    renderRelationChip(rel, list, onAdd);
  }
  return list;
}

/**
 * One ancestor's relations, folded behind a toggle that names and counts them.
 *
 * Collapsed by default, but never silent about what it holds: 1201 D3FEND
 * classes state no relation of their own, so a fold that hid the count would put
 * those panels back to looking empty, which is the bug ADR 0030 fixed. The
 * heading is the disclosure.
 *
 * `hidden` on the list, toggled in place — the same idiom `renderDefinition`
 * uses, and it has to act in place because `renderNodePanel` rebuilds the whole
 * modal and would close every other fold the reader had opened.
 */
function renderInheritedGroup({ via, rows }, host, onAdd) {
  const list = relationList(rows, onAdd);
  list.hidden = true;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'node-panel-more';
  toggle.setAttribute('aria-expanded', 'false');
  const label = (expanded) => `${expanded ? '▾' : '▸'} as ${resolveLabel(via)} (${rows.length})`;
  toggle.textContent = label(false);
  toggle.title =
    `D3FEND states these on d3f:${via}, a superclass of this node, so they hold of it ` +
    'without being stated on it.';
  toggle.addEventListener('click', () => {
    const expanded = list.hidden;
    list.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = label(expanded);
  });

  const line = document.createElement('p');
  line.className = 'node-panel-inherited-toggle';
  line.appendChild(toggle);
  host.appendChild(line);
  host.appendChild(list);
}

/**
 * One of the panel's three relation sections: what the class states, then what
 * each superclass states, folded.
 */
function renderRelationSection(title, relations, host, onAdd) {
  if (!relations.length) return;
  const heading = document.createElement('h4');
  heading.textContent = title;
  host.appendChild(heading);

  const { own, inherited } = groupByAncestor(relations);
  if (own.length) host.appendChild(relationList(own, onAdd));
  for (const group of inherited) renderInheritedGroup(group, host, onAdd);
}

/**
 * What the "mint neighbours" button is about to do, as a sentence — including the
 * reason it is disabled, which is otherwise indistinguishable from a broken button.
 *
 * Exported for the tests, like `addButtonTitle`: it is the part that is not DOM.
 */
export function mintButtonTitle(localName, count) {
  if (!count) {
    return (
      `${resolveLabel(localName)} (${localName}) has no neighbours in its own D3FEND branch. ` +
      'Defensive measures live in another branch — use the "+" on a Defense row for those.'
    );
  }
  return (
    `Add ${count} instance${count === 1 ? '' : 's'} — one per D3FEND class neighbouring ` +
    `${localName} in the same branch — to a named graph you pick, each linked to this node by ` +
    'the property the ontology states between their classes. Naming a graph another node ' +
    'already used adds to it instead of duplicating what is there. The diagram source is not ' +
    'touched; remove the graph again from the Graphs panel.'
  );
}

/**
 * The button that mints a node's neighbourhood into a named graph.
 *
 * One button per D3FEND class of the node, not one per relation row: the whole
 * point is getting the neighbourhood in a single move. Like `renderAddButton` it
 * reports in place rather than re-rendering, which would close every "Show more"
 * the user had opened — but unlike it, the button stays live afterwards. A node
 * can belong to more than one neighbourhood graph, so "already done" is not a
 * state this button has.
 */
function renderMintButton(localName, host, onMint) {
  const count = neighbourClasses(localName).length;
  const idle = count ? `Add ${count} neighbours to a graph` : 'No neighbours in this branch';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'node-panel-mint';
  button.textContent = idle;
  button.title = mintButtonTitle(localName, count);
  button.disabled = !count;

  const status = document.createElement('span');
  status.className = 'node-panel-mint-status';

  button.addEventListener('click', async () => {
    button.disabled = true;
    // Whatever the outcome, the button goes back to being pressable: the next
    // click is a legitimate "and also add it to that other graph".
    const outcome = await onMint(localName);
    button.disabled = false;
    status.textContent = outcome ? `✓ ${outcome}` : '';
  });

  host.appendChild(button);
  host.appendChild(status);
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
 * Separates what the class states itself from what it inherits, and buckets the
 * inherited rows by the ancestor that states them.
 *
 * `via` is the ancestor `this` stands for in the row
 * (editor/d3fendRestrictions.js), so a bucket answers "what is true of this node
 * *as* a d3f:Firewall" — which is why the ancestor is named once per bucket
 * rather than repeated on every row.
 *
 * Input order is preserved throughout: `relationsFor` returns nearest ancestor
 * first, so the buckets come out most-specific first and rows keep their order
 * inside one. A Map does that for free; an object keyed by class name would not
 * be safe to rely on for a name like `constructor`.
 *
 * Pure, and exported for the tests, like `groupRelations` above.
 */
export function groupByAncestor(relations = []) {
  const own = [];
  const buckets = new Map();
  for (const rel of relations) {
    if (!rel.via) {
      own.push(rel);
      continue;
    }
    const bucket = buckets.get(rel.via);
    if (bucket) bucket.push(rel);
    else buckets.set(rel.via, [rel]);
  }
  return {
    own,
    inherited: [...buckets].map(([via, rows]) => ({ via, rows })),
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
 *
 * `actions.onMintNeighbours(localName)` — when given — puts one button per D3FEND
 * class below its relation rows, minting that class's same-branch neighbourhood
 * into a named graph. It resolves to a sentence saying what happened, or a falsy
 * value when nothing was added (the user cancelled, or there was nothing new).
 * Unlike `onAddRelation` it does not touch the diagram source, so it is offered
 * for nodes that were never written in mermaid.
 */
export function renderNodePanel(host, nodeData, store, actions = {}) {
  // `displayId`, not the label's first line: that line is the id only while the
  // whole stack is drawn, and in `name` mode it is the rdfs:label instead. The IRI
  // in `id` is the last resort rather than the first fallback — a raw urn: or
  // http: in the title tells the reader nothing.
  renderPanelFrame(host, nodeData.displayId || nodeData.label?.split('\n')[0] || nodeData.id);

  const quads = store.getSubjectQuads(nodeData.id);
  const classNames = d3fClassLocalNames(quads);
  const metadataEntries = classNames
    .map((localName) => ({ localName, entry: d3fendMetadata[localName] }))
    .filter(({ entry }) => entry);
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

  for (const { localName, entry } of metadataEntries) {
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
    //
    // `relationsFor` rather than `entry.relations`: D3FEND states almost nothing
    // on a leaf class, so the file's own rows leave 2160 of its 3655 classes with
    // an empty panel — `d3f:WebServerApplication` among them, though
    // `d3f:Software` above it states four relations
    // (docs/adr/0030-inherited-relations-and-alternative-properties.md).
    const { attack, defense, related } = groupRelations(relationsFor(localName));
    renderRelationSection('Attack', attack, section, actions.onAddRelation);
    renderRelationSection('Defense', defense, section, actions.onAddRelation);
    renderRelationSection('Relations', related, section, actions.onAddRelation);

    // Below the rows, because it is about all of them at once. Offered even when
    // the node is absent from the mermaid source — nothing here writes mermaid.
    if (actions.onMintNeighbours) renderMintButton(localName, section, actions.onMintNeighbours);

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
