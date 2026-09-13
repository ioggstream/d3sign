/**
 * The graph view's preference defaults — the values a user who has never touched
 * the View popover sees.
 *
 * Kept in their own file so changing what the app opens with is one edit in one
 * place, with no risk of disturbing the loading, clamping and migration logic that
 * reads them (viz/graphPrefs.js). It is a module rather than JSON because each
 * default is a decision, and the reason it is what it is lives beside it.
 *
 * Two rules hold across the whole object and are worth stating once:
 *
 * - **A preference that changes which elements exist defaults off.** A diagram is
 *   first seen as its triples describe it; a view that adds, removes or reroutes
 *   elements is something the user opts into. `collapseArtifactPaths`,
 *   `orientByFlow` and `locationView` are the three — the first two false, and the
 *   third at the one of its values that draws everything.
 * - **Everything else is a matter of taste**, and defaults to whatever reads best
 *   on the example corpus.
 *
 * Ranges, allowed values and the migration of older payloads are *not* here:
 * those are validation, and they live with the loader that applies them.
 */
export const DEFAULT_PREFS = {
  nodeStyle: 'color',
  // Defaults to the whole stack — id, rdfs:label, rdf:type — because that is what
  // the drawing has always said. `name` draws the label alone and moves the id and
  // the type to the hover tooltip.
  labelDetail: 'full',
  nodeSpacing: 60,
  nodeSize: 30,
  fontSize: 10,
  // Extra room inside a container, *added* to what its own label needs rather
  // than replacing it: at 0 a container is as tight as its label allows, which is
  // the rendering to compare any complaint against.
  containerPadding: 0,
  // The info panel's text, which is HTML rather than a cytoscape label and so has
  // nothing to do with `fontSize`: the panel has to stay readable at a font size
  // that would crowd the drawing. 13px is the previous fixed --fs-md.
  panelFontSize: 13,
  // The three CodeMirror panes, which used to disagree: the source editor took the
  // 16px document default and the TriG and SPARQL panes a fixed --fs-sm (12px).
  // One size for all three, between the two.
  editorFontSize: 13,
  edgeLabels: true,
  // How a link is routed. A matter of taste by the second rule above — it changes how
  // links are drawn, never which of them exist — so it defaults to the curve the graph
  // has always drawn, and every other value is something the user goes looking for.
  edgeStyle: 'bezier',
  // How a node's place is drawn: `off` leaves the location links alone, `pins` puts
  // the place on the node, `boxes` draws the node inside its place. Both of the
  // latter remove the links they replace, so by the rule above neither is the
  // default (docs/adr/0036-location-pins.md).
  locationView: 'off',
  // Changes *which* elements exist rather than how they are drawn, so it defaults
  // off: a diagram must first be seen as the TriG describes it
  // (docs/adr/0026-collapse-artifact-mediated-paths.md).
  collapseArtifactPaths: false,
  // Off for the same reason: it changes what the arrows say, and a diagram has to
  // be readable as the TriG describes it before it is reoriented
  // (docs/adr/0035-improve-flow-discovery.md).
  orientByFlow: false,
};
