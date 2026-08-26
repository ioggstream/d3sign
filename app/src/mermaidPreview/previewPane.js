import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import { loadIconSet } from '../viz/icons.js';

let initialized = false;
let renderCounter = 0;

async function ensureInitialized() {
  if (initialized) return;
  mermaid.registerLayoutLoaders(elkLayouts);
  // Shared with the graph pane, so the set is fetched once. Icons are a visual
  // nicety only; rendering still works without them.
  const d3fIcons = await loadIconSet();
  if (d3fIcons) mermaid.registerIconPacks([{ name: 'd3f', icons: d3fIcons }]);
  // suppressErrorRendering keeps failures out of the document: mermaid otherwise
  // paints its "bomb" SVG into a temp div appended to <body> and leaves it there,
  // one per failed render, and resolves (instead of rejecting) on parse errors.
  mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true });
  initialized = true;
}

/** Removes temp containers a previous mermaid version may have left on <body>. */
function removeStrayTempElements() {
  for (const node of document.querySelectorAll('[id^="dmermaid-preview-"]')) {
    node.remove();
  }
}

/**
 * Renders raw mermaid source (a full ```mermaid block's inner text) into
 * `host` as an SVG. This pane mirrors diagrams/template.html and is a
 * validity/visual check only — it is not the interactive filtered view.
 */
export async function renderMermaidPreview(host, mermaidText, onError) {
  await ensureInitialized();
  const id = `mermaid-preview-${renderCounter++}`;
  removeStrayTempElements();
  try {
    const { svg } = await mermaid.render(id, mermaidText);
    host.innerHTML = svg;
    onError?.(null);
  } catch (error) {
    // The message can echo the user's source, so build it as text, not markup.
    const box = document.createElement('div');
    box.className = 'mermaid-error';
    box.textContent = error?.message ?? String(error);
    host.replaceChildren(box);
    removeStrayTempElements();
    onError?.(error);
  }
}
