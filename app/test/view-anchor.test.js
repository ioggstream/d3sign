import { describe, it, expect } from 'vitest';
import { anchoredViewport } from '../src/viz/viewAnchor.js';

describe('anchoredViewport', () => {
  it('keeps the zoom it was given', () => {
    expect(anchoredViewport({ x: 0, y: 0 }, 2.5, { x: 0, y: 0 }).zoom).toBe(2.5);
  });

  it('is the plain offset at zoom 1', () => {
    expect(anchoredViewport({ x: 300, y: 200 }, 1, { x: 120, y: 40 }).pan).toEqual({
      x: 180,
      y: 160,
    });
  });

  it('scales the node position by the zoom', () => {
    expect(anchoredViewport({ x: 300, y: 200 }, 2, { x: 120, y: 40 }).pan).toEqual({
      x: 60,
      y: 120,
    });
  });

  it('pans negative when the node sits past the anchor point', () => {
    // Zoomed in on a node far down the drawing: the origin is off-screen to the
    // top left, which is what a negative pan means.
    expect(anchoredViewport({ x: 100, y: 100 }, 3, { x: 400, y: 500 }).pan).toEqual({
      x: -1100,
      y: -1400,
    });
  });

  it('round-trips: the model point lands back on the rendered point', () => {
    const rendered = { x: 512, y: 288 };
    const position = { x: 137.5, y: -42.25 };
    const { zoom, pan } = anchoredViewport(rendered, 1.75, position);
    expect(position.x * zoom + pan.x).toBeCloseTo(rendered.x);
    expect(position.y * zoom + pan.y).toBeCloseTo(rendered.y);
  });
});
