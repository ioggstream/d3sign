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
export function edgePanelSummary(data = {}) {
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
 * Renders the edge info modal into `host` (the shared `<dialog>`).
 *
 * `actions.onGoToSource` — when given — puts a "Go to mermaid source" button at the
 * end, the same action the right-click menu offers. The panel is handed the
 * callback rather than the editor, because the view is not allowed to know mermaid
 * exists (docs/adr/0014-graph-view-from-rdf-only.md); the shell connects the two.
 */
export function renderEdgePanel(host, edgeData, actions = {}) {
  const summary = edgePanelSummary(edgeData);

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
