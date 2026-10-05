/**
 * The graph tab's page: the SPA's graph view, mounted on a shell that talks to the
 * extension host (docs/adr/0043-vscode-extension.md). Anything that touches the
 * document — revealing a line, an edit, a prompt, a graph the user adds — is a
 * message; whether something *has* a source line is answered here, from the text the
 * host last sent.
 */

import { mountGraphView } from '../../app/src/viz/mountGraphView.js';
import {
  collectSourceLocations,
  edgeLocationsFor,
  sourceLocationsFor,
} from '../../app/src/editor/sourceLocations.js';
import { fromFlatContribution, toFlatContribution } from '../src/flat.js';

const vscode = acquireVsCodeApi();

// What the host last sent. `index` is built on first use and dropped with the text.
let current = { uri: null, text: '', index: null, known: new Set() };
const pending = new Map();
let nextId = 1;

const send = (type, payload) => vscode.postMessage({ type, uri: current.uri, ...payload });

function request(type, payload) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send(type, { id, ...payload });
  });
}

const index = () => (current.index ??= collectSourceLocations(current.text));

const view = mountGraphView(document.getElementById('graph-pane'), {
  isActive: () => true,
  prompt: (message, value) => request('prompt', { message, value }),
  knownGraphNames: () => current.known,
  source: {
    has: (mermaidId) => sourceLocationsFor(index(), mermaidId).length > 0,
    reveal: (mermaidId) => send('reveal', { mermaidId }),
    hasEdge: (keys) => edgeLocationsFor(index(), keys).length > 0,
    revealEdge: (keys) => send('revealEdge', { keys }),
    addRelation: (mermaidId, rel) => request('addRelation', { mermaidId, rel }),
    changeClass: (mermaidId, oldQname, newQname) =>
      request('changeClass', { mermaidId, oldQname, newQname }),
  },
  onAddGraph: async (contribution) => {
    current.known = new Set(await request('addGraph', { contribution: toFlatContribution(contribution) }));
  },
  onRemoveGraph: async (name) => {
    current.known = new Set(await request('removeGraph', { name }));
  },
  onQueryNode: (iri) => send('queryNode', { iri }),
  onQueryClassPair: (pair) => send('queryClassPair', { pair }),
});

window.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'document': {
      current = { uri: data.uri, text: data.text, index: null, known: new Set(data.knownGraphNames) };
      const { warnings } = view.setDocument(data.contributions.map(fromFlatContribution));
      send('warnings', { warnings });
      break;
    }
    case 'reply':
      pending.get(data.id)?.(data.result);
      pending.delete(data.id);
      break;
    case 'show':
      view.fitView();
      break;
    default:
      break;
  }
});

vscode.postMessage({ type: 'ready' });
