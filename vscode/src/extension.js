import * as vscode from 'vscode';
import { createPipeline } from './pipeline.js';
import { createPanelHost } from './panels.js';
import { classTokenReplacement } from '../../app/src/editor/classSwap.js';
import { relationInsertion } from '../../app/src/editor/insertMeasure.js';
import {
  collectSourceLocations,
  edgeLocationsFor,
  pickSourceLocation,
  sourceLocationsFor,
} from '../../app/src/editor/sourceLocations.js';
import wellKnownAuthFlows from '../../app/src/data/enrichment/well-known-auth-flows.ttl?raw';

// docs/adr/0043-vscode-extension.md. The webview mounts the graph view; this host
// owns the document model, the edits and the read-only TriG document.

const TRIG_SCHEME = 'd3sign-trig';
// Same debounce as the SPA's editor (app/src/editor/editorPane.js), and the same
// flash length as its reveal (app/src/editor/revealFlash.js).
const DEBOUNCE_MS = 200;
const FLASH_MS = 2000;

/** The virtual document that shows `source` as TriG; the source URI rides in the query. */
const trigUriFor = (source) =>
  vscode.Uri.from({ scheme: TRIG_SCHEME, path: `${source.path}.trig`, query: source.toString() });

export function activate(context) {
  const pipeline = createPipeline({ enrichmentTurtle: wellKnownAuthFlows });
  const diagnostics = vscode.languages.createDiagnosticCollection('d3sign');
  const trigChanged = new vscode.EventEmitter();
  const flash = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  });
  context.subscriptions.push(diagnostics, trigChanged, flash);

  // The graph tab follows the last markdown editor that had focus. Focus moving to
  // the webview or to the TriG document leaves it where it was.
  let activeKey = null;
  // Warnings about the merged store, which only the graph view can compute.
  const viewWarnings = new Map();

  const documentFor = (key) => vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);

  function publishDiagnostics(doc, parserWarnings) {
    const range = doc.lineCount ? doc.lineAt(0).range : new vscode.Range(0, 0, 0, 0);
    const warnings = [...parserWarnings, ...(viewWarnings.get(doc.uri.toString()) ?? [])];
    // The parser reports no position, so every warning sits on the first line.
    diagnostics.set(
      doc.uri,
      warnings.map((message) => {
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = 'd3sign';
        return diagnostic;
      }),
    );
  }

  let lastParserWarnings = [];

  function refresh(doc) {
    const key = doc.uri.toString();
    const text = doc.getText();
    const { warnings, contributions, knownGraphNames } = pipeline.update(key, text);
    lastParserWarnings = warnings;
    publishDiagnostics(doc, warnings);
    graph.post({ type: 'document', uri: key, version: doc.version, text, contributions, knownGraphNames });
    trigChanged.fire(trigUriFor(doc.uri));
  }

  // -------------------------------------------------------------------------
  // The source: reveal and edit through the real document
  // -------------------------------------------------------------------------

  async function reveal(key, locationsFor) {
    const doc = documentFor(key);
    if (!doc) return false;
    // The editor that already shows it, so the webview's own group does not take it.
    const shown = vscode.window.visibleTextEditors.find((editor) => editor.document === doc);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: shown?.viewColumn ?? vscode.ViewColumn.One,
    });
    const text = doc.getText();
    // Cycles from the caret, so repeated jumps walk the places a node is written.
    const target = pickSourceLocation(locationsFor(collectSourceLocations(text)), doc.offsetAt(editor.selection.active));
    if (!target) return false;
    const range = new vscode.Range(doc.positionAt(target.from), doc.positionAt(target.to));
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.setDecorations(flash, [range]);
    setTimeout(() => editor.setDecorations(flash, []), FLASH_MS);
    return true;
  }

  /** Applies a `{ from, to?, insert }` change from the editor helpers to the document. */
  async function applyChange(key, makeChange) {
    const doc = documentFor(key);
    if (!doc) return false;
    const change = makeChange(doc.getText());
    if (!change) return false;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(change.from), doc.positionAt(change.to ?? change.from)),
      change.insert,
    );
    // The edit marks the file dirty: saving and committing it is the user's, as for
    // any other change. The text-change listener then redraws the graph.
    return vscode.workspace.applyEdit(edit);
  }

  // -------------------------------------------------------------------------
  // The graph tab
  // -------------------------------------------------------------------------

  async function onGraphMessage(message) {
    const reply = (result) => graph.post({ type: 'reply', id: message.id, result });
    switch (message.type) {
      case 'ready': {
        const doc = activeKey && documentFor(activeKey);
        if (doc) refresh(doc);
        break;
      }
      case 'reveal':
        await reveal(message.uri, (index) => sourceLocationsFor(index, message.mermaidId));
        break;
      case 'revealEdge':
        await reveal(message.uri, (index) => edgeLocationsFor(index, message.keys));
        break;
      case 'addRelation':
        reply(await applyChange(message.uri, (text) => relationInsertion(text, message.mermaidId, message.rel)));
        break;
      case 'changeClass':
        reply(
          await applyChange(message.uri, (text) =>
            classTokenReplacement(text, message.mermaidId, message.oldQname, message.newQname),
          ),
        );
        break;
      case 'prompt': {
        const answer = await vscode.window.showInputBox({ prompt: message.message, value: message.value });
        reply(answer ?? null);
        break;
      }
      case 'addGraph': {
        const known = pipeline.addGraph(message.uri, message.contribution);
        trigChanged.fire(trigUriFor(vscode.Uri.parse(message.uri)));
        reply(known);
        break;
      }
      case 'removeGraph': {
        const known = pipeline.removeGraph(message.uri, message.name);
        trigChanged.fire(trigUriFor(vscode.Uri.parse(message.uri)));
        reply(known);
        break;
      }
      case 'warnings': {
        viewWarnings.set(message.uri, message.warnings);
        const doc = documentFor(message.uri);
        if (doc) publishDiagnostics(doc, lastParserWarnings);
        break;
      }
      case 'queryNode':
      case 'queryClassPair':
        vscode.window.showInformationMessage('d3sign: the SPARQL tab is not part of this build yet.');
        break;
      default:
        break;
    }
  }

  const graph = createPanelHost({
    context,
    viewType: 'd3sign.graph',
    title: 'D3FEND Graph',
    script: 'graph.js',
    paneId: 'graph-pane',
    onMessage: onGraphMessage,
    // Cytoscape measured a hidden container as zero, so it frames the drawing again.
    onVisible: () => graph.post({ type: 'show' }),
  });

  // -------------------------------------------------------------------------
  // Following the editor
  // -------------------------------------------------------------------------

  function follow(editor) {
    const doc = editor?.document;
    if (!doc || doc.languageId !== 'markdown') return;
    activeKey = doc.uri.toString();
    refresh(doc);
  }

  let timer = null;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(follow),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== activeKey || !event.contentChanges.length) return;
      clearTimeout(timer);
      timer = setTimeout(() => refresh(event.document), DEBOUNCE_MS);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      pipeline.dispose(key);
      viewWarnings.delete(key);
      diagnostics.delete(doc.uri);
      if (key === activeKey) activeKey = null;
    }),
    vscode.workspace.registerTextDocumentContentProvider(TRIG_SCHEME, {
      onDidChange: trigChanged.event,
      async provideTextDocumentContent(uri) {
        const source = vscode.Uri.parse(uri.query);
        const doc = await vscode.workspace.openTextDocument(source);
        // Re-parsed here so the document is right even when it was never the active one.
        pipeline.update(source.toString(), doc.getText());
        return pipeline.trig(source.toString());
      },
    }),
    vscode.commands.registerCommand('d3sign.openGraph', () => {
      follow(vscode.window.activeTextEditor);
      graph.reveal();
    }),
    vscode.commands.registerCommand('d3sign.openTrig', async () => {
      follow(vscode.window.activeTextEditor);
      const doc = activeKey && documentFor(activeKey);
      if (!doc) {
        vscode.window.showInformationMessage('d3sign: open a markdown file first.');
        return;
      }
      const trig = await vscode.workspace.openTextDocument(trigUriFor(doc.uri));
      await vscode.window.showTextDocument(trig, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
        preserveFocus: true,
      });
    }),
  );

  follow(vscode.window.activeTextEditor);
}

export function deactivate() {}
