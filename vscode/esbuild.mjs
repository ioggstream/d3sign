// Bundles the extension host (Node, CommonJS) and the graph page (browser, IIFE).
// Sources come from ../app/src, so a change there ships with the next build and
// needs no edit here (docs/adr/0043-vscode-extension.md).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// `import x from './file?raw'` is a Vite feature the shared sources use.
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
      namespace: 'raw',
    }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, 'utf8'))}`,
      loader: 'js',
    }));
  },
};

const common = { bundle: true, minify: true, plugins: [raw], logLevel: 'info' };

mkdirSync('dist', { recursive: true });

await build({
  ...common,
  entryPoints: ['src/extension.js'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
});

await build({
  ...common,
  entryPoints: ['webview/graph.js'],
  outfile: 'dist/graph.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
});

copyFileSync('../app/src/styles/app.css', 'dist/app.css');
