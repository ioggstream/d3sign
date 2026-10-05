# D3sign for VS Code

Draws the D3FEND graph of the mermaid diagrams in a markdown file, and shows the
RDF they produce as TriG. The source is VS Code's own markdown editor, so saving and
committing are the usual ones.

- **Open D3FEND graph** (`Alt+G`) opens the graph in a tab beside the editor. It
  follows the markdown file you edited last.
- **Open RDF (TriG)** (`Alt+R`) opens a read-only document generated from the file.
- Warnings the parser raises (a link with no `d3f:` prefix, a back arrow) are
  listed in the Problems panel.
- In the graph, `g` jumps to the mermaid line a node or link was written on, and
  the `+` in a node's info panel writes a relation into the file.

The extension reuses the code of the web app in `app/`; see
`docs/adr/0043-vscode-extension.md` in the repository. (Plain paths, not links: the
packager rejects relative links in a README when the manifest names no repository.)

## Build

```sh
cd vscode && npm install    # once, creates package-lock.json
sh vscode/build.sh          # from the repository root; needs docker
code --install-extension vscode/d3sign.vsix
```
