/**
 * The edge info modal: what a drawn link actually asserts.
 *
 * The counterpart of viz/nodePanel.js, opened by the same gesture — a double click,
 * or `Show info` on the right-click menu (docs/adr/0019-select-and-swap-edges.md).
 * It shares that panel's `<dialog>`, close button and CSS, so the two read as one
 * feature and only one of them can be open.
 *
 * It exists because a drawn edge is not the triple that was written, and four
 * transforms can sit in between: a flipped predicate reverses it and renames it,
 * a fold re-anchors an endpoint onto a visible ancestor, a group of folded links
 * can collapse into one arrow, and an artifact-mediated path can collapse into an
 * arrow that names no predicate at all
 * (docs/adr/0026-collapse-artifact-mediated-paths.md). `foldedFrom`/`foldedTo` and
 * `standsFor` were recorded so none of that is lossy; this is what reads them back.
 *
 * `edgePanelSummary` holds the whole answer as plain data, and the renderer only
 * turns it into DOM — the same split viz/selectionBox.js and viz/graphStyle.js use,
 * for the same reason: the wording is the part worth asserting on, and none of it
 * needs a browser.
 */

import { displayIdOf } from '../rdf/graphModel.js';
import { getItem } from '../editor/d3fendHierarchy.js';
import { renderDefinition, renderPanelFrame } from './nodePanel.js';

/**
 * Everything the panel says about `data` (a cytoscape edge's data), as plain data.
 *
 * `predicate` is always the CURIE as written and `label` is what is drawn, so
 * `flipped` is simply the two disagreeing — no filter state needed, which is what
 * keeps this a pure function of one argument.
 *
 * The definition is looked up for the *written* predicate even when the drawing is
 * flipped: the inverse names come from rdf/inverse-map.json, which invents display
 * labels the ontology does not always define (`d3f:read-by` is not a D3FEND
 * property), so looking one up would just find nothing.
 */
export function edgePanelSummary(data = {}, { alternatives = [] } = {}) {
  const written = data.predicate || '';
  // The ×N count belongs to the fold, not to the predicate, and is reported
  // separately below.
  const drawn = (data.label || written).split(' ×')[0];
  // The CURIE as written *is* the term's identity (editor/vocabularies.js), so a
  // predicate from any known vocabulary resolves here, and one from none resolves to
  // nothing — which is what an invented inverse name like d3f:read-by should do.
  const item = getItem(written);

  // A collapsed artifact path has no written predicate at all — its `predicate` is
  // a synthetic key — so "drawn differs from written" is trivially true of it and
  // would print `written as collapsed:urn:…`, which says nothing. The direction it
  // draws is the direction both its legs were written in, so it is never flipped.
  const collapsed = Boolean(data.collapsed);

  const summary = {
    drawn,
    written,
    collapsed,
    flipped: !collapsed && Boolean(drawn && written) && drawn !== written,
    kind: data.kind || 'other',
    invertible: Boolean(data.invertible),
    definition: item?.documentation || null,
    source: displayIdOf(data.source || ''),
    target: displayIdOf(data.target || ''),
    derived: Boolean(data.derived),
    // One drawn link standing for the relation asserted each way. The panel is
    // the only place that says so in words, since the drawing says it with a
    // second arrowhead and nothing else.
    bidirectional: Boolean(data.bidirectional),
    standsFor: [],
    // The other predicates D3FEND licenses between these two classes, computed
    // by the shell and handed in — resolving them needs the model's rdf:type,
    // which the view has no access to (ADR 0014). The row whose predicate is the
    // one on screen is marked rather than dropped: it is the axiom that licenses
    // what is drawn, which is the first thing the section has to say.
    alternatives: alternatives.map((row) => ({ ...row, current: row.predicate === written })),
  };

  // A collapsed path is the one derived edge that knows its own triples exactly:
  // two of them, with two different predicates, which is why they are recorded as
  // triples rather than as the two endpoint sets a fold uses. Each row therefore
  // carries its own predicate instead of the drawn label.
  if (collapsed) {
    summary.payloadLabel = data.payloadLabel || drawn;
    summary.foldedCount = data.foldedCount || 0;
    summary.standsFor = (data.standsFor || []).map((triple) => ({
      source: displayIdOf(triple.from),
      predicate: triple.predicate,
      target: displayIdOf(triple.to),
    }));
    return summary;
  }

  // A derived edge is not a triple in the store: it stands for the child links a
  // fold re-anchored onto the container. Their endpoints are recorded as two sets
  // rather than as pairs, so this is the cross product — the same over-approximation
  // goToSource.js works with, and it is labelled as "up to" for that reason.
  if (summary.derived) {
    const from = data.foldedFrom || [];
    const to = data.foldedTo || [];
    summary.foldedCount = data.foldedCount || 0;
    const pairs = from.flatMap((f) =>
      to.map((t) => ({ source: displayIdOf(f), target: displayIdOf(t) })),
    );
    // Both ends of a two-way link were folded, so both cross products are links
    // the one arrow stands for.
    summary.standsFor = summary.bidirectional
      ? [...pairs, ...pairs.map((p) => ({ source: p.target, target: p.source }))]
      : pairs;
  }

  return summary;
}

function appendBadge(host, text, className = 'node-panel-badge') {
  const badge = document.createElement('span');
  badge.className = className;
  badge.textContent = text;
  host.appendChild(badge);
  return badge;
}

/** One `source → predicate → target` row, in the node panel's chip styling. */
function appendRelationRow(host, { source, predicate, target }) {
  const row = document.createElement('li');
  row.className = 'node-panel-chip-row';

  const sourceChip = document.createElement('span');
  sourceChip.className = 'node-panel-chip';
  sourceChip.textContent = source;

  const predicateLabel = document.createElement('span');
  predicateLabel.className = 'node-panel-chip-predicate';
  predicateLabel.textContent = `→ ${predicate}`;

  const targetChip = document.createElement('span');
  targetChip.className = 'node-panel-chip';
  targetChip.textContent = target;

  row.append(sourceChip, predicateLabel, targetChip);
  host.appendChild(row);
}

/**
 * What a candidate row says about itself beyond the axiom, in order.
 *
 * Each badge is only ever present when it is true of the row: an exact match is
 * the unremarkable case, most predicates have no declared inverse, and the
 * predicate already drawn is one row out of several. `written the other way` is
 * here rather than in the arrow because the arrow runs along the axiom, which is
 * stated in one direction whichever way the drawn edge would go.
 *
 * Pure, and exported for the tests: the row itself is DOM, and this is the part
 * of it worth asserting on.
 */
export function alternativeBadges(row = {}) {
  const badges = [];
  if (row.current) badges.push('as drawn');
  if (row.direction === 'in') badges.push('written the other way');
  if (row.tier === 'narrower') badges.push('narrower');
  if (!row.inverse) badges.push('no inverse');
  return badges;
}

/**
 * One candidate, drawn as the axiom it comes from: `via —predicate→ filler`.
 *
 * The axiom rather than the predicate alone, because the predicate alone is not
 * unique: `d3f:accesses` is stated on `d3f:NetworkResourceAccess` twice, once
 * with `d3f:NetworkResource` at the far end and once with `d3f:Resource`, and
 * two rows reading `d3f:accesses` with nothing to tell them apart are worse than
 * one. It is also the same three-part shape `appendRelationRow` uses below.
 */
function appendAlternativeRow(host, row) {
  const li = document.createElement('li');
  li.className = 'node-panel-chip-row';

  const via = document.createElement('span');
  via.className = 'node-panel-chip';
  via.textContent = row.via;
  li.appendChild(via);

  const predicate = document.createElement('span');
  predicate.className = 'node-panel-chip-predicate';
  // Unconditional, because the two chips either side of it are the axiom's own
  // ends, in the order the axiom states them. Which way the *drawn* edge would
  // then run is a different fact, and it is a badge below.
  predicate.textContent = `→ ${row.predicate}`;
  predicate.title =
    `D3FEND states ${row.predicate} on d3f:${row.via}, with d3f:${row.filler} at the other end` +
    (row.inverse ? `. Its inverse is ${row.inverse}.` : '');
  li.appendChild(predicate);

  const filler = document.createElement('span');
  filler.className = 'node-panel-chip';
  filler.textContent = row.filler;
  li.appendChild(filler);

  for (const badge of alternativeBadges(row)) appendBadge(li, badge);

  host.appendChild(li);
}

/**
 * The alternatives section: which other predicates could carry this link.
 *
 * Read-only. Applying one means rewriting a single link's predicate in the
 * mermaid source, and the direction swap next to it is still per-predicate and
 * global (docs/adr/0019-select-and-swap-edges.md), so offering a per-edge write
 * here would put two different scopes one click apart. `Go to mermaid source`
 * below is how a reader acts on what this says.
 */
function renderAlternatives(summary, host, actions) {
  const heading = document.createElement('h4');
  heading.textContent = `Alternative predicates (${summary.alternatives.length})`;
  host.appendChild(heading);

  if (!summary.alternatives.length) {
    const note = document.createElement('p');
    // An empty list is a finding, not a missing section: D3FEND constrains both
    // ends, so "nothing licenses this pair" is what it usually means, and an
    // absent section would read as "not checked".
    note.textContent =
      'D3FEND states no relation between these two classes, in either direction. ' +
      'The query below relaxes that to one end at a time.';
    host.appendChild(note);
  } else {
    const list = document.createElement('ul');
    list.className = 'node-panel-chip-list';
    for (const row of summary.alternatives) appendAlternativeRow(list, row);
    host.appendChild(list);
  }

  if (!actions.onQueryAlternatives) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'node-panel-more';
  button.textContent = 'Query these in SPARQL';
  button.title =
    'Open the SPARQL pane on this pair. Deleting the two tier branches widens it to ' +
    'every predicate licensed on one end, with the other end unconstrained.';
  button.addEventListener('click', () => actions.onQueryAlternatives());
  host.appendChild(button);
}

/**
 * Renders the edge info modal into `host` (the shared `<dialog>`).
 *
 * `actions.onGoToSource` — when given — puts a "Go to mermaid source" button at the
 * end, the same action the right-click menu offers. The panel is handed the
 * callback rather than the editor, because the view is not allowed to know mermaid
 * exists (docs/adr/0014-graph-view-from-rdf-only.md); the shell connects the two.
 */
export function renderEdgePanel(host, edgeData, actions = {}, options = {}) {
  const summary = edgePanelSummary(edgeData, options);

  renderPanelFrame(host, summary.drawn);

  const section = document.createElement('div');
  section.className = 'node-panel-d3fend';

  appendBadge(section, summary.kind);
  // Only ever said when it is true of the edge: an asserted link says nothing about
  // folding, and a predicate with no inverse says nothing about direction.
  if (summary.collapsed) appendBadge(section, 'collapsed artifact path');
  else if (summary.derived) appendBadge(section, 'derived from a fold');
  if (summary.bidirectional) appendBadge(section, 'asserted both ways');
  if (summary.invertible) appendBadge(section, 's: swap direction');

  if (summary.definition) renderDefinition(summary.definition, section);

  const list = document.createElement('ul');
  list.className = 'node-panel-chip-list';
  appendRelationRow(list, { source: summary.source, predicate: summary.drawn, target: summary.target });
  // The second head on the line stands for a second triple, and this is the row
  // that names it. Not shown for a derived edge: there the links the arrow stands
  // for are listed in full below, both ways included.
  if (summary.bidirectional && !summary.derived) {
    appendRelationRow(list, { source: summary.target, predicate: summary.drawn, target: summary.source });
  }
  section.appendChild(list);

  // The direction on screen is a view setting, and a per-predicate one: saying which
  // way the triple was actually written is the only way to tell a reversed drawing
  // from a differently written diagram.
  if (summary.flipped) {
    const note = document.createElement('p');
    note.textContent = `Drawn inverted: written as ${summary.written}, so ${summary.target} → ${summary.source}.`;
    section.appendChild(note);
  }

  host.appendChild(section);

  if (summary.derived) {
    const heading = document.createElement('h4');
    heading.textContent = summary.collapsed
      ? `Stands for (${summary.standsFor.length})`
      : `Folded links (${summary.foldedCount})`;
    host.appendChild(heading);

    const folded = document.createElement('ul');
    folded.className = 'node-panel-chip-list';
    // A collapsed path's rows carry their own predicate, since its two legs are
    // written with two different ones. A fold's do not: `foldedFrom`/`foldedTo` hold
    // the endpoints as *drawn*, so pairing them with the written CURIE would print a
    // triple backwards whenever the direction is flipped.
    for (const pair of summary.standsFor) {
      appendRelationRow(folded, {
        source: pair.source,
        predicate: pair.predicate ?? summary.drawn,
        target: pair.target,
      });
    }
    host.appendChild(folded);
  }

  // Not for a collapsed artifact path: its arrow names no predicate of its own,
  // so there is nothing for a candidate to be an alternative *to*, and the two
  // legs it stands for are listed above with their own predicates.
  if (!summary.collapsed) renderAlternatives(summary, host, actions);

  if (actions.onGoToSource) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'node-panel-more';
    button.textContent = 'Go to mermaid source';
    button.title = 'Close this panel and scroll the editor to the line that writes this link';
    button.addEventListener('click', () => actions.onGoToSource());
    host.appendChild(button);
  }

  if (!host.open) host.showModal();
}
