/**
 * Makes a CSS-grid gutter draggable, moving width (or height) between the two
 * tracks on either side of it.
 *
 * Two modes, because the two callers want different things:
 *
 * - **Model-backed** (`getSizes` + `setSizes`): the drag operates on the
 *   caller's own array of fractions and hands back a new one, which the caller
 *   normalizes, renders and stores. `beforeIndex`/`afterIndex` index into that
 *   array, not into the grid tracks. This is the column layout
 *   (layout/columns.js), where the model owns the widths.
 * - **DOM-backed** (neither): the sizes are read from the resolved grid template
 *   and written straight back as `fr`. Enough for a split inside a single pane,
 *   which has no state worth keeping.
 *
 * The DOM cannot be the source of truth in the first case: `getComputedStyle`
 * resolves a grid template to *pixels*, and reading those back as `fr` let a
 * drag resurrect a column that had been deliberately collapsed to zero width.
 *
 * Returns a teardown function that unbinds the window listeners.
 */
export function makeResizableGutter(
  gutter,
  { container, axis, beforeIndex, afterIndex, min = 80, getSizes, setSizes, onResize },
) {
  let dragging = false;
  let startPos = 0;
  let startSizes = [];
  let containerExtent = 0;

  const propName = axis === 'row' ? 'gridTemplateRows' : 'gridTemplateColumns';
  const modelBacked = Boolean(getSizes && setSizes);

  // Derived from where the gutter actually sits, so the DOM-backed caller cannot
  // get its track indices out of step with the markup. Tracks alternate
  // pane/gutter, so the neighbours are the elements either side of this one.
  //
  // An index may also be a function: which two columns a gutter divides changes
  // as columns empty and refill, and the answer is only known at drag time.
  const domTrack = () => [...container.children].indexOf(gutter);
  const resolve = (index, fallback) => (typeof index === 'function' ? index() : (index ?? fallback));
  const before = () => resolve(beforeIndex, domTrack() - 1);
  const after = () => resolve(afterIndex, domTrack() + 1);

  function readSizes() {
    if (modelBacked) return getSizes();
    return getComputedStyle(container)[propName].split(' ').map((tok) => parseFloat(tok) || 1);
  }

  function writeSizes(sizes) {
    if (modelBacked) setSizes(sizes);
    else container.style[propName] = sizes.map((s) => `${s}fr`).join(' ');
  }

  function pointerPos(e) {
    return axis === 'row' ? e.clientY : e.clientX;
  }

  function onPointerDown(e) {
    dragging = true;
    startPos = pointerPos(e);
    startSizes = readSizes();
    const rect = container.getBoundingClientRect();
    containerExtent = axis === 'row' ? rect.height : rect.width;
    document.body.style.cursor = axis === 'row' ? 'row-resize' : 'col-resize';
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const delta = pointerPos(e) - startPos;
    const totalFraction = startSizes.reduce((a, b) => a + b, 0);
    const deltaFraction = (delta / containerExtent) * totalFraction;

    const sizes = [...startSizes];
    const a = before();
    const b = after();
    const minFraction = (min / containerExtent) * totalFraction;

    sizes[a] = Math.max(minFraction, startSizes[a] + deltaFraction);
    sizes[b] = Math.max(minFraction, startSizes[b] - deltaFraction);

    writeSizes(sizes);
    onResize?.();
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
  }

  gutter.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  return () => {
    gutter.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };
}
