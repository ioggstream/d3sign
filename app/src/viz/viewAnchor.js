/**
 * Viewport arithmetic for keeping the reader's place across a re-layout.
 *
 * A fold re-runs the layout, which moves every node, so the pan and zoom that
 * framed the old drawing mean nothing in the new one. What can be carried across
 * is a single node: put it back under the same pixel at the same zoom and the
 * drawing has changed around a fixed point the reader was already looking at.
 */

/**
 * The `{ zoom, pan }` that draws model point `position` at rendered point
 * `rendered`, inverting cytoscape's `rendered = position * zoom + pan`.
 */
export function anchoredViewport(rendered, zoom, position) {
  return {
    zoom,
    pan: {
      x: rendered.x - zoom * position.x,
      y: rendered.y - zoom * position.y,
    },
  };
}
