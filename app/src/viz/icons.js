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
 * Wraps an icon body in a root `<svg>` tinted with `color`, as a percent-encoded
 * data URI.
 *
 * The tint is the root's `color` property, *not* a substitution of the string
 * `currentColor` in the body. `color` is inherited, so every `fill="currentColor"`
 * in the body still resolves to the tint — but a subtree that sets its own `color`
 * keeps it. That distinction is load-bearing for compound icons: their cut-out
 * mask works by setting `color="black"` on the `<g>` holding the overlay's
 * silhouette, whose paths carry `fill="currentColor"`. Substituting the string
 * overwrote those paths with the node's colour, leaving `color="black"` nothing to
 * act on — the mask then rendered at the tint's luminance instead of black, so
 * the cut-out was a ghost rather than a hole and the base bled through the badge.
 *
 * Percent-encoded rather than base64: cytoscape hands the URI straight to the
 * browser, and `#` in a colour would otherwise terminate the URL.
 *
 * `width` and `height` are emitted as attributes as well as a viewBox. A viewBox
 * alone leaves the SVG with no intrinsic size, which the browser then resolves
 * against the viewport — so the rasterized icon's size drifted as the graph was
 * zoomed while the node kept its model size, and the icon outgrew its node.
 */
function svgDataUri({ body, width, height }, color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}" color="${color}">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** An `svg+xml` data URI for the single icon `name`, tinted with `color`. */
export function iconDataUri(iconSet, name, color) {
  const icon = iconOf(iconSet, name);
  return icon && svgDataUri(icon, color);
}

/** One icon's body with its box resolved, or undefined when the set lacks it. */
function iconOf(iconSet, name) {
  const icon = iconSet?.icons?.[name];
  if (!icon) return undefined;
  return {
    body: icon.body,
    width: icon.width ?? iconSet.width ?? 24,
    height: icon.height ?? iconSet.height ?? 24,
  };
}

/**
 * The classes drawn as the *badge* of a compound icon — what a node is served or
 * hosted as, which qualifies the more specific thing it actually is.
 *
 * D3FEND names only a few of the combinations an architecture needs: it has
 * DatabaseServiceApplication and DHCPServiceApplication, but nothing for a code
 * repository served over the network. Such a node carries both classes, and this
 * list is what decides which of them draws the glyph and which decorates it: the
 * listed one becomes the small overlay, and the other draws the icon. A node
 * typed `d3f:ServiceApplication d3f:CodeRepository` is therefore a code
 * repository, badged as an application — which is how the icon set composes the
 * combinations it does name, `DatabaseServiceApplication` being
 * `mdi:database_{mdi:application-outline}`.
 *
 * Order is priority, and the list is a *ranking*, not a gate: a node whose
 * classes all match it still gets a compound icon, with the earliest entry as its
 * badge. Matching is inherited — a class qualifies if it *is* or descends from a
 * listed one, so DatabaseServiceApplication ranks via ServiceApplication without
 * being named here.
 *
 * That inheritance is why this cannot be a gate. ComputerPlatform, Application
 * and Software sit near the top of their subtrees, so most of D3FEND descends
 * from one of them; requiring exactly one class to match would have refused to
 * compound most real pairs — Host + WebServer, Process + Browser — and silently
 * drawn a single icon.
 *
 * This is the list to edit when a diagram badges the wrong way round. It is a
 * list of classes rather than of pairs on purpose: the combinations are
 * open-ended, the things that host them are not.
 */
export const BADGE_CLASSES = [
  'ServiceApplication',
  'Process',
  'Application',
  'Software',
  'Host',
  'ComputerNetworkNode',
  'ComputerPlatform',
  'Network',
  'Storage',
  'User',
  'UserAccount',
];

/**
 * How far `localName` sits below D3FENDCore, following the first parent at each
 * level like resolveIconName does. Used only to order candidate badges, so that
 * the most specific class is the one that gets drawn.
 */
function hierarchyDepth(localName) {
  const visited = new Set();
  let name = localName;
  let depth = 0;
  while (name && !visited.has(name)) {
    visited.add(name);
    name = getParents(`d3f:${name}`)[0]?.slice('d3f:'.length);
    if (name) depth += 1;
  }
  return depth;
}

/**
 * How strongly `localName` claims to be the badge: its index in BADGE_CLASSES,
 * itself or inherited, and Infinity for a class the list does not reach. The walk
 * is the same first-parent chain resolveIconName takes.
 */
function badgeRank(localName) {
  const visited = new Set();
  let name = localName;
  while (name && !visited.has(name)) {
    const rank = BADGE_CLASSES.indexOf(name);
    if (rank !== -1) return rank;
    visited.add(name);
    name = getParents(`d3f:${name}`)[0]?.slice('d3f:'.length);
  }
  return Infinity;
}

// Upstream's compound geometry (ioggstream/d3fend-icons, scripts/build.mjs). The
// same numbers, so an icon the icon set ships ready-made and one composed here
// look alike.
const OVERLAY_SCALE = 0.6;
const OVERLAY_MARGIN = 0;
const OVERLAY_CUTOUT_STROKE = 5;

/**
 * Rewrites every `id` in `body`, and the references to it, with `__${suffix}`.
 *
 * A compound body is three copies of two icons in one document, and an icon the
 * set already ships compound brings its own `<mask id="compound-mask-...">` along
 * — in *both* copies of the overlay, since the cut-out needs one and the drawn
 * badge needs the other. Duplicate ids in one document are not an error: the
 * browser resolves `url(#x)` to whichever came first, which is the copy buried
 * inside our mask. The two copies used to be textually identical so this went
 * unnoticed; they are not any more.
 *
 * A regex is enough because these bodies are machine-generated by the upstream
 * builder — no `<style>` blocks, no CSS selectors, no script.
 */
export function withScopedIds(body, suffix) {
  const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  let scoped = body;
  for (const id of new Set(ids)) {
    const quoted = id.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    scoped = scoped
      .replaceAll(new RegExp(`\\bid="${quoted}"`, 'g'), `id="${id}__${suffix}"`)
      .replaceAll(new RegExp(`url\\(#${quoted}\\)`, 'g'), `url(#${id}__${suffix})`)
      .replaceAll(new RegExp(`href="#${quoted}"`, 'g'), `href="#${id}__${suffix}"`);
  }
  return scoped;
}

/**
 * The icon for a node that carries several D3FEND classes: the glyph of the
 * specific thing it is, badged in the bottom-right corner with what it is served
 * as, so the node reads as the combined class the ontology does not define.
 *
 * Returns `{ body, width, height }` on the *base's* box — the base then needs no
 * transform, and the composite keeps an intrinsic size, which the stylesheet's
 * `background-fit: contain` depends on (see svgDataUri).
 *
 * Falls back to a single icon, unchanged, whenever there is nothing to compound:
 * one class, or several that resolve to the same icon. The latter is the common
 * case — the icon set is small, so two classes often walk up to the same
 * ancestor, and a glyph must not be stamped on itself as its own badge.
 */
export function composeIconBody(iconSet, localNames) {
  // Resolution first, deduped on the *icon*, not the class.
  const byIcon = new Map();
  for (const localName of localNames ?? []) {
    const iconName = resolveIconName(iconSet, localName);
    if (iconName && !byIcon.has(iconName)) byIcon.set(iconName, localName);
  }
  if (!byIcon.size) return undefined;

  // Most badge-like first: BADGE_CLASSES, then the general before the specific,
  // then the name so that two classes the ontology ranks equally still land the
  // same way round every time. The *second* entry draws the glyph, because what a
  // node is served as qualifies what it is, not the other way round.
  const ordered = [...byIcon]
    .map(([iconName, localName]) => ({ iconName, localName }))
    .sort(
      (a, b) =>
        badgeRank(a.localName) - badgeRank(b.localName) ||
        hierarchyDepth(a.localName) - hierarchyDepth(b.localName) ||
        a.localName.localeCompare(b.localName),
    );

  // One icon: it is the node's whole picture, whichever class it came from.
  if (ordered.length < 2) return iconOf(iconSet, ordered[0].iconName);
  return compound(iconOf(iconSet, ordered[1].iconName), iconOf(iconSet, ordered[0].iconName));
}

/**
 * Upstream's buildCompoundIcon over two resolved bodies: a mask punches the
 * overlay's silhouette, plus a stroked halo around it, out of the base, and the
 * overlay is then drawn into the hole.
 *
 * `k` is derived rather than fixed at 0.6 so an overlay on a box other than the
 * base's still lands square in the corner. The halo compensates for it in turn:
 * `stroke-width` sits on the `<g>` that carries `scale(k)`, so the drawn halo is
 * `stroke-width * k` and would otherwise thin out as `k` fell.
 */
function compound(base, overlay) {
  const k = Math.min(
    (base.width * OVERLAY_SCALE) / overlay.width,
    (base.height * OVERLAY_SCALE) / overlay.height,
  );
  const tx = base.width - OVERLAY_MARGIN - overlay.width * k;
  const ty = base.height - OVERLAY_MARGIN - overlay.height * k;
  const stroke = (OVERLAY_CUTOUT_STROKE * OVERLAY_SCALE * (base.width / 24)) / k;
  const transform = `translate(${tx} ${ty}) scale(${k})`;
  const maskId = 'd3sign-badge';

  // `color="black"` is what makes the silhouette black: the overlay's paths carry
  // fill="currentColor" and resolve it against this group rather than the root's
  // tint. Nothing here may substitute that string away (see svgDataUri).
  const cutout =
    `<g transform="${transform}" color="black" fill="black" stroke="black"` +
    ` stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"` +
    ` paint-order="stroke fill">${withScopedIds(overlay.body, 'c')}</g>`;

  const body =
    `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0"` +
    ` width="${base.width}" height="${base.height}">` +
    `<rect x="0" y="0" width="${base.width}" height="${base.height}" fill="white"/>` +
    `${cutout}</mask></defs>` +
    `<g mask="url(#${maskId})">${withScopedIds(base.body, 'b')}</g>` +
    `<g transform="${transform}">${withScopedIds(overlay.body, 'o')}</g>`;

  return { body, width: base.width, height: base.height };
}

/**
 * A data URI for a node's classes: the compound glyph when they make one, the
 * single icon otherwise. The whole-icon entry point for the stylesheet.
 */
export function composeIconUri(iconSet, localNames, color) {
  const icon = composeIconBody(iconSet, localNames);
  return icon && svgDataUri(icon, color);
}
