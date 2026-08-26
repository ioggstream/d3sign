/**
 * The query worker: a message pump over queryEngine.js.
 *
 * It exists because a knowledge base is big. Parsing 3.6 MB of turtle and running
 * a join over ~130k triples on the main thread would freeze the tab for seconds,
 * and oxigraph's `query()` is synchronous — there is no yielding inside it. Off
 * the main thread, a slow query costs responsiveness nowhere
 * (docs/adr/0020-sparql-query-engine.md).
 *
 * The consequence, which the client owns: a running query cannot be interrupted.
 * Cancelling means terminating this worker.
 */

import init, * as oxigraph from 'oxigraph/web.js';
import wasmUrl from 'oxigraph/web_bg.wasm?url';
import { createQueryEngine } from './queryEngine.js';

let engine = null;

/**
 * Reads a knowledge base body, inflating it only if it actually arrived compressed.
 *
 * Sniffed from the gzip magic number rather than trusted from the manifest, because
 * who decompresses is not ours to decide. Vite's dev server recognises the `.gz`
 * extension and serves the file with `Content-Encoding: gzip`, so the *browser*
 * inflates it and `fetch` hands back plaintext turtle; a plain static host or a CDN
 * may serve the same bytes with no encoding header, leaving them compressed.
 * Decompressing unconditionally errored the stream in the first case, and
 * `new Response(errored).text()` rejects with Chrome's generic "Failed to fetch" —
 * a network-shaped message for a decoding bug, which is why this is sniffed now.
 *
 * Either way the transfer is compressed, so the wire saving still stands.
 */
async function readBody(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Fetches a knowledge base, failing with something a user can act on.
 *
 * The three ways this goes wrong all look alike from the outside and need telling
 * apart: the file was never produced (the common one), the dev server answered with
 * its SPA fallback so the "turtle" is actually index.html, and the request never
 * completed at all.
 *
 * `missingHint` comes from the manifest entry rather than being written here: each
 * knowledge base is produced differently, and the D3FEND recipe this used to print
 * unconditionally is wrong advice for any other one.
 */
async function fetchKnowledgeBase(url, missingHint) {
  const hint = missingHint ? ` ${missingHint}` : '';

  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(`Could not fetch ${url} (${cause?.message ?? cause}).${hint}`);
  }

  if (response.status === 404) {
    throw new Error(`${url} is missing.${hint}`);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);

  // A dev server that rewrites unknown paths to index.html would otherwise surface
  // as an unintelligible gzip or turtle parse error.
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    throw new Error(`${url} returned HTML, not RDF — the file is missing and the dev server fell back to index.html.`);
  }

  return readBody(response);
}

async function ensureEngine() {
  if (engine) return engine;
  // The options object, not the bare URL: wasm-bindgen deprecated the positional
  // form, and it tells the two apart by the argument being a plain object literal.
  // The URL is passed explicitly rather than left to init()'s own
  // `new URL('web_bg.wasm', import.meta.url)` fallback, so Vite resolves the asset
  // through its pipeline and the hashed filename survives a build.
  await init({ module_or_path: wasmUrl });
  engine = createQueryEngine(oxigraph);
  return engine;
}

const handlers = {
  async init() {
    await ensureEngine();
    return {};
  },

  async loadKg({ graphName, url, missingHint }) {
    const active = await ensureEngine();
    const turtle = await fetchKnowledgeBase(url, missingHint);
    return active.loadTurtle(graphName, turtle);
  },

  async dropKg({ graphName }) {
    (await ensureEngine()).dropGraph(graphName);
    return { graphName };
  },

  async sync({ graphNames, nquads }) {
    (await ensureEngine()).syncGraphs(graphNames, nquads);
    return { synced: graphNames.length };
  },

  async query({ sparql, maxRows }) {
    return (await ensureEngine()).query(sparql, { maxRows });
  },
};

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data ?? {};
  const handler = handlers[type];
  if (!handler) {
    self.postMessage({ id, ok: false, error: { message: `unknown request "${type}"` } });
    return;
  }
  try {
    self.postMessage({ id, ok: true, result: await handler(payload ?? {}) });
  } catch (error) {
    // Errors cross postMessage as plain objects, and oxigraph's parse errors carry
    // the line/column the query pane needs to point at.
    self.postMessage({
      id,
      ok: false,
      error: {
        message: error?.message ?? String(error),
        line: typeof error?.line === 'number' ? error.line : null,
        column: typeof error?.column === 'number' ? error.column : null,
      },
    });
  }
};
