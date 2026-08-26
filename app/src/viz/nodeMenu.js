/**
 * What goes in the graph's right-click menus, as plain
 * `[{ label, hint, onSelect }]`.
 *
 * Split out of graphPane.js so the "which actions does this element offer?"
 * question is answerable without a canvas: the cursor hint and the menu itself
 * both need it, and getting them out of step is how you end up advertising a
 * menu that opens empty. An empty array means there is nothing to offer, and
 * the menu stays shut.
 *
 * `hint` is how the same action is reached without the menu. The menu is the one
 * place every gesture is written down, so it is where they are taught — a keyboard
 * shortcut nobody can discover may as well not exist.
 *
 * `description` is the same thing for the action itself: a label of two words and a
 * one-letter shortcut says what to press, not what will happen. It is rendered as
 * the item's tooltip (viz/graphPane.js) and every item carries one.
 */

const GO_TO_SOURCE = 'Go to mermaid source';

/**
 * Fold/unfold first — it was here first, and the muscle memory is worth keeping.
 * `Show info` comes last and is offered on every node: a left click now selects
 * rather than opening the panel (ADR 8), so this menu is the only way in.
 */
export function nodeMenuItems(
  data,
  {
    onFoldToggle,
    onGoToSource,
    canGoToSource,
    onShowInfo,
    onShowOutgoingFlow,
    onShowIncomingFlow,
    onQuery,
  } = {},
) {
  const items = [];
  if (onFoldToggle && data.foldable) {
    items.push({
      label: data.folded ? 'Unfold' : 'Fold',
      hint: 'f',
      description: data.folded
        ? 'Draw this container\'s children again, each with its own links'
        : 'Collapse this container into one node, with its children\'s links drawn on it. The RDF is untouched',
      onSelect: () => onFoldToggle(data.id),
    });
  }
  if (onGoToSource && canGoToSource?.(data.id)) {
    items.push({
      label: GO_TO_SOURCE,
      hint: 'g',
      description: 'Scroll the mermaid editor to the line that writes this node',
      onSelect: () => onGoToSource(data.id),
    });
  }
  if (onShowOutgoingFlow) {
    items.push({
      label: 'Show outgoing flow',
      hint: '>',
      description: 'Hide everything the drawing does not reach by following links out of this node',
      onSelect: () => onShowOutgoingFlow(data.id),
    });
  }
  if (onShowIncomingFlow) {
    items.push({
      label: 'Show incoming flow',
      hint: '<',
      description: 'Hide everything that does not reach this node by following links into it',
      onSelect: () => onShowIncomingFlow(data.id),
    });
  }
  // Before `Show info`, which is the terminal action: this one leaves the tab.
  if (onQuery) {
    items.push({
      label: 'Query this node',
      hint: 'q',
      description: 'Open the SPARQL pane on a query for every triple of this node',
      onSelect: () => onQuery(data.id),
    });
  }
  if (onShowInfo) {
    items.push({
      label: 'Show info',
      hint: 'double-click',
      description:
        'Open the info panel: the D3FEND definition, the attack, defense and other relations the ontology knows, and every RDF property',
      onSelect: () => onShowInfo(data),
    });
  }
  return items;
}

/**
 * Edges get the same wording, so the gesture reads the same wherever it is
 * used. The whole `data` is handed back rather than an id: recovering the
 * written triple needs the filter state, which only the shell has.
 *
 * Every item carries a hint now that an edge can be selected and the keyboard can
 * reach it (docs/adr/0019-select-and-swap-edges.md) — the previous note here, that
 * only nodes are selectable so `g` would promise something that does nothing, no
 * longer holds.
 *
 * `Swap direction` comes first: it is what a left click used to do, so this menu is
 * where that muscle memory is redirected. It is offered only when the predicate has
 * an inverse, which is the same condition `s` itself checks.
 */
export function edgeMenuItems(data, { onSwapDirection, onGoToEdgeSource, canGoToEdgeSource, onShowEdgeInfo } = {}) {
  const items = [];
  if (onSwapDirection && data.invertible) {
    items.push({
      label: 'Swap direction',
      hint: 's',
      description: `Draw every ${data.predicate} link the other way round, named by its inverse. The RDF is untouched`,
      onSelect: () => onSwapDirection(data.predicate),
    });
  }
  if (onGoToEdgeSource && canGoToEdgeSource?.(data)) {
    items.push({
      label: GO_TO_SOURCE,
      hint: 'g',
      description: 'Scroll the mermaid editor to the line that writes this link',
      onSelect: () => onGoToEdgeSource(data),
    });
  }
  if (onShowEdgeInfo) {
    items.push({
      label: 'Show info',
      hint: 'double-click',
      description: 'Open the info panel: which triple this link stands for, which way it is drawn, and what the predicate means',
      onSelect: () => onShowEdgeInfo(data),
    });
  }
  return items;
}
