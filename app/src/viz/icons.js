/**
 * The D3FEND icon set, shared by the mermaid preview and the graph pane.
 *
 * The set is an Iconify-style JSON — `{ prefix, width, height, icons: { Name: { body } } }` —
 * whose icon names are D3FEND resource local names, so `d3f:DigitalArtifact`
 * resolves to the icon named `DigitalArtifact`. The set is small and the
 * ontology is large, so a node's own class rarely has an icon: resolution walks
 * up the D3FEND class hierarchy and uses the nearest ancestor that does.
 *
 * Everything here degrades to `null`/`undefined` when the set could not be
 * fetched — icons are a visual nicety, never a precondition for rendering.
 */
import { getParents } from '../editor/d3fendHierarchy.js';

const ICONS_URL = 'https://cdn.jsdelivr.net/gh/ioggstream/d3fend-icons@main/icons.json';

let pending = null;

/** Fetches the icon set once per session; resolves to `null` if it is unavailable. */
export function loadIconSet() {
  pending ??= fetch(ICONS_URL)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return pending;
}

/**
 * Icon name for a D3FEND local name: the name itself, else its nearest ancestor
 * with an icon, following the first parent at each level like
 * d3fendHierarchy.getAncestorPath does. Returns undefined when nothing matches.
 */
export function resolveIconName(iconSet, localName) {
  if (!iconSet?.icons || !localName) return undefined;
  const visited = new Set();
  let name = localName;
  while (name && !visited.has(name)) {
    if (iconSet.icons[name]) return name;
    visited.add(name);
    // The icon set is keyed by bare D3FEND local name, while terms are addressed by
    // qname now that the editor knows more than one vocabulary (editor/vocabularies.js).
    name = getParents(`d3f:${name}`)[0]?.slice('d3f:'.length);
  }
  return undefined;
}

/**
 * An `svg+xml` data URI for `name`, tinted with `color`. Icon bodies are drawn
 * with `fill="currentColor"`, which has no meaning inside a background-image, so
 * the colour is substituted in.
 *
 * Percent-encoded rather than base64: cytoscape hands the URI straight to the
 * browser, and `#` in a colour would otherwise terminate the URL.
 *
 * `width` and `height` are emitted as attributes as well as a viewBox. A viewBox
 * alone leaves the SVG with no intrinsic size, which the browser then resolves
 * against the viewport — so the rasterized icon's size drifted as the graph was
 * zoomed while the node kept its model size, and the icon outgrew its node.
 */
export function iconDataUri(iconSet, name, color) {
  const icon = iconSet?.icons?.[name];
  if (!icon) return undefined;
  const width = icon.width ?? iconSet.width ?? 24;
  const height = icon.height ?? iconSet.height ?? 24;
  const body = icon.body.replaceAll('currentColor', color);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
