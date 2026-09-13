/**
 * The body of the View chip's popover: how the D3FEND Graph draws itself.
 *
 * Every control reports the whole next preferences object, so the caller has a
 * single place to persist and apply it — the same shape the filter panels use.
 */

import { DEFAULT_PREFS, PREF_RANGES } from './graphPrefs.js';

const SLIDERS = [
  { key: 'nodeSpacing', label: 'Node spacing', hint: 'Room the layout leaves between nodes' },
  { key: 'nodeSize', label: 'Node size', hint: 'Diameter of a node, and of its icon' },
  { key: 'fontSize', label: 'Label size', hint: 'Node and link label text size' },
  {
    key: 'containerPadding',
    label: 'Container padding',
    hint: 'Extra room inside a container, beyond what its own label needs',
  },
  { key: 'panelFontSize', label: 'Panel text size', hint: 'Text size of the node and link info panels' },
  { key: 'editorFontSize', label: 'Editor text size', hint: 'Text size of the source, TriG and SPARQL editors' },
];

const NODE_STYLE_OPTIONS = [
  { value: 'color', label: 'Colours', hint: 'A dot per D3FENDCore branch' },
  { value: 'icon', label: 'Icons', hint: 'D3FEND icons, tinted by branch; colours where no icon exists' },
];

const LABEL_DETAIL_OPTIONS = [
  { value: 'full', label: 'Full', hint: 'The id, the rdfs:label and the rdf:type, stacked' },
  {
    value: 'name',
    label: 'Name only',
    hint: 'Just the rdfs:label, or the id when there is none; the rest on hover',
  },
];

// docs/adr/0036-location-pins.md. The `pins` hint carries the warning
// the ADR asks for: an inherited place is drawn on a node that states no triple
// about it, and the TriG pane will not show a matching line.
const LOCATION_VIEW_OPTIONS = [
  { value: 'off', label: 'Links', hint: 'The location links, drawn as links' },
  {
    value: 'pins',
    label: 'Pins',
    hint:
      'The place on each node, with the links hidden. A node inside a located ' +
      'container shows its container’s place, which no triple of its own states',
  },
  {
    value: 'boxes',
    label: 'Boxes',
    hint:
      'Each node drawn inside a box for its place, with the links hidden. A node ' +
      'already inside a container stays there',
  },
];

// cytoscape's `curve-style` values, named for what they look like rather than for
// what cytoscape calls them: "taxi" is a routing term, and the popover is read by
// someone looking at a drawing.
const EDGE_STYLE_OPTIONS = [
  // { value: 'bezier', label: 'Curved', hint: 'One curve per link, spread apart where several share a pair' },
  {
    value: 'round-taxi',
    label: 'Orthogonal, rounded',
    hint: 'Right-angled routing with rounded corners',
  },
  // { value: 'taxi', label: 'Orthogonal, square', hint: 'Right-angled routing with square corners' },
  /*{
    value: 'round-segments',
    label: 'Segments, rounded',
    hint: 'Straight segments with rounded corners, routed freely rather than along the axes',
  },*/
  {
    value: 'straight',
    label: 'Straight',
    hint: 'One straight line per link; links sharing a pair of nodes lie on top of each other',
  },
];

/**
 * A `<select>` for one enum preference, for a list too long to spend a radio on each.
 * The hint goes on the option as well as on the row, since a closed dropdown shows
 * only the chosen label.
 */
function selectField({ label: labelText, options, selected, onPick }) {
  const field = document.createElement('label');
  field.className = 'prefs-select';

  const name = document.createElement('span');
  name.textContent = labelText;

  const select = document.createElement('select');
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    item.title = option.hint;
    if (option.value === selected) item.selected = true;
    select.appendChild(item);
  }
  select.addEventListener('change', () => onPick(select.value));

  field.append(name, select);
  return field;
}

/**
 * A `<fieldset>` of radios for one enum preference. `name` is shared across the
 * group's inputs, which is what gives the browser roving-focus arrow keys — so it
 * has to be distinct per group.
 */
function radioGroup({ legend: legendText, name, options, selected, onPick }) {
  const group = document.createElement('fieldset');
  group.className = 'prefs-group';
  const legend = document.createElement('legend');
  legend.textContent = legendText;
  group.appendChild(legend);
  for (const option of options) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.checked = selected === option.value;
    radio.addEventListener('change', () => onPick(option.value));
    label.append(radio, ` ${option.label}`);
    label.title = option.hint;
    group.appendChild(label);
  }
  return group;
}

function addRow(list, className, control) {
  const item = document.createElement('li');
  item.className = className;
  item.appendChild(control);
  list.appendChild(item);
  return item;
}

/**
 * Renders the preferences controls into `host`, calling `onChange(nextPrefs)` on
 * every interaction. Sliders fire on `input`, so the graph follows the drag.
 * `bulkHost` gets the reset action, next to the popover's title.
 *
 * The panel keeps its own copy of the preferences and never needs re-rendering
 * from the caller: a re-render mid-drag would replace the input the pointer is
 * holding. Reset is the one action that rebuilds it, since it moves every control.
 */
export function renderPrefsPanel(host, prefs, onChange, { bulkHost } = {}) {
  host.innerHTML = '';
  let current = { ...prefs };
  const emit = (patch) => {
    current = { ...current, ...patch };
    onChange(current);
  };

  if (bulkHost) {
    bulkHost.innerHTML = '';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'reset';
    reset.title = 'Back to the default rendering';
    reset.addEventListener('click', () => {
      onChange({ ...DEFAULT_PREFS });
      renderPrefsPanel(host, DEFAULT_PREFS, onChange, { bulkHost });
    });
    bulkHost.appendChild(reset);
  }

  const list = document.createElement('ul');
  list.className = 'filter-list prefs-panel';

  addRow(
    list,
    'prefs-row',
    radioGroup({
      legend: 'Nodes',
      name: 'prefs-node-style',
      options: NODE_STYLE_OPTIONS,
      selected: prefs.nodeStyle,
      onPick: (nodeStyle) => emit({ nodeStyle }),
    }),
  );

  addRow(
    list,
    'prefs-row',
    radioGroup({
      legend: 'Labels',
      name: 'prefs-label-detail',
      options: LABEL_DETAIL_OPTIONS,
      selected: prefs.labelDetail,
      onPick: (labelDetail) => emit({ labelDetail }),
    }),
  );

  for (const { key, label, hint } of SLIDERS) {
    const [min, max] = PREF_RANGES[key];
    const field = document.createElement('label');
    field.className = 'prefs-slider';
    field.title = hint;

    const name = document.createElement('span');
    name.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(prefs[key]);

    const value = document.createElement('span');
    value.className = 'prefs-value';
    value.textContent = String(prefs[key]);

    slider.addEventListener('input', () => {
      value.textContent = slider.value;
      emit({ [key]: Number(slider.value) });
    });

    field.append(name, slider, value);
    addRow(list, 'prefs-row', field);
  }

  const edgeLabel = document.createElement('label');
  const edgeToggle = document.createElement('input');
  edgeToggle.type = 'checkbox';
  edgeToggle.checked = prefs.edgeLabels;
  edgeToggle.addEventListener('change', () => emit({ edgeLabels: edgeToggle.checked }));
  edgeLabel.append(edgeToggle, ' Link labels');
  edgeLabel.title = 'Predicate names along the links';
  addRow(list, 'prefs-row', edgeLabel);

  const edgeStyleField = selectField({
    label: 'Link shape',
    options: EDGE_STYLE_OPTIONS,
    selected: prefs.edgeStyle,
    onPick: (edgeStyle) => emit({ edgeStyle }),
  });
  edgeStyleField.title = 'How a link is routed between its two nodes';
  addRow(list, 'prefs-row', edgeStyleField);

  addRow(
    list,
    'prefs-row',
    radioGroup({
      legend: 'Location',
      name: 'prefs-location-view',
      options: LOCATION_VIEW_OPTIONS,
      selected: prefs.locationView,
      onPick: (locationView) => emit({ locationView }),
    }),
  );

  const collapseLabel = document.createElement('label');
  const collapseToggle = document.createElement('input');
  collapseToggle.type = 'checkbox';
  collapseToggle.checked = prefs.collapseArtifactPaths;
  collapseToggle.addEventListener('change', () =>
    emit({ collapseArtifactPaths: collapseToggle.checked }),
  );
  collapseLabel.append(collapseToggle, ' Collapse artifact paths');
  collapseLabel.title =
    'An artifact that only sits between a producer and a consumer becomes the label on one arrow between them';
  addRow(list, 'prefs-row', collapseLabel);

  const orientLabel = document.createElement('label');
  const orientToggle = document.createElement('input');
  orientToggle.type = 'checkbox';
  orientToggle.checked = prefs.orientByFlow;
  orientToggle.addEventListener('change', () => emit({ orientByFlow: orientToggle.checked }));
  orientLabel.append(orientToggle, ' Orient links along the flow');
  orientLabel.title =
    'Draws each link in the direction the flow runs, using its inverse name where that is backwards from the triple';
  addRow(list, 'prefs-row', orientLabel);

  host.appendChild(list);
}
