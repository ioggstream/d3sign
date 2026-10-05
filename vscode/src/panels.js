import * as vscode from 'vscode';

const PAGE_STYLE = `
  body { display: flex; flex-direction: column; }
  #graph-pane { flex: 1; margin: var(--s-2); }
`;

/**
 * A webview panel that shows one script from `dist/`, and the stylesheet the SPA
 * ships. The CSP lets the page load only those two files and the D3FEND icon set
 * (`ICONS_URL` in app/src/viz/icons.js); the app styles itself light whatever the
 * VS Code theme, so no theme variables are bridged.
 *
 * `retainContextWhenHidden` keeps the Cytoscape pan and zoom while the tab is in
 * the background, at the cost of the page's memory.
 */
export function createPanelHost({ context, viewType, title, script, paneId, onMessage, onVisible }) {
  let panel = null;

  function html(webview) {
    const dist = (file) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', file));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      'connect-src https://cdn.jsdelivr.net',
    ].join('; ');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${dist('app.css')}">
  <style>${PAGE_STYLE}</style>
  <title>${title}</title>
</head>
<body>
  <section id="${paneId}" class="pane" role="tabpanel"></section>
  <script src="${dist(script)}"></script>
</body>
</html>`;
  }

  return {
    isOpen: () => panel !== null,

    /** Shows the panel beside the editor, creating it on first use. */
    reveal() {
      if (panel) {
        panel.reveal(undefined, true);
        return;
      }
      panel = vscode.window.createWebviewPanel(viewType, title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      });
      panel.webview.html = html(panel.webview);
      panel.webview.onDidReceiveMessage(onMessage, undefined, context.subscriptions);
      panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.visible) onVisible?.();
      }, undefined, context.subscriptions);
      panel.onDidDispose(() => {
        panel = null;
      }, undefined, context.subscriptions);
    },

    post: (message) => panel?.webview.postMessage(message),
  };
}
