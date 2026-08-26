/**
 * Main-thread façade over the query worker.
 *
 * Owns three things the pane should not have to think about:
 *
 *   - the worker's lifecycle, including the respawn that "cancel" really is;
 *   - which knowledge bases are loaded, and their state for the Sources chip;
 *   - flushing document graphs into the engine, on Run and never on a keystroke.
 */

import { toNQuads } from '../rdf/serialize.js';
import { KNOWLEDGE_BASES } from '../rdf/knowledgeBases.js';
import { MAX_ROWS } from './queryEngine.js';

/** `idle` before anything is asked of it; `failed` keeps the error for the chip. */
const initialStates = () =>
  new Map(
    KNOWLEDGE_BASES.map((kb) => [
      kb.id,
      { state: 'idle', triples: 0, inferred: 0, ms: 0, error: null },
    ]),
  );

export function createQueryClient({ onSourcesChange } = {}) {
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  let sources = initialStates();
  /** Knowledge bases the user has asked for, so a respawn can restore them. */
  const wanted = new Set();
  let running = null;

  function notify() {
    onSourcesChange?.(sourcesSnapshot());
  }

  function sourcesSnapshot() {
    return KNOWLEDGE_BASES.map((kb) => ({ ...kb, ...sources.get(kb.id) }));
  }

  function spawn() {
    if (worker) return worker;
    worker = new Worker(new URL('./queryWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(Object.assign(new Error(data.error.message), data.error));
    };
    // A worker that dies takes every in-flight request with it; failing them is
    // the only way the caller learns.
    worker.onerror = (event) => {
      const message = event?.message || 'the query worker crashed';
      for (const [, entry] of pending) entry.reject(new Error(message));
      pending.clear();
    };
    return worker;
  }

  function send(type, payload) {
    const active = spawn();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      active.postMessage({ id, type, payload });
    });
  }

  async function loadSource(id) {
    const kb = KNOWLEDGE_BASES.find((entry) => entry.id === id);
    if (!kb) return;
    wanted.add(id);
    sources.set(id, { state: 'loading', triples: 0, inferred: 0, ms: 0, error: null });
    notify();
    try {
      const { triples, inferred, ms } = await send('loadKg', {
        graphName: kb.graph,
        // Absolute, resolved here rather than in the worker: a relative fetch inside
        // a worker resolves against the *worker script's* URL (…/src/query/), not the
        // page, so `kg/d3fend.ttl.gz` would ask for …/src/query/kg/d3fend.ttl.gz.
        // document.baseURI also carries a non-root Vite `base`, which the worker
        // cannot see.
        url: new URL(kb.url, document.baseURI).href,
        // What to tell the user when the file is not there. Each base is produced
        // differently, so the recipe belongs to the manifest entry, not the worker.
        missingHint: kb.missingHint,
      });
      sources.set(id, { state: 'ready', triples, inferred, ms, error: null });
    } catch (error) {
      // Stays wanted: a failed fetch is usually transient, and the chip offers a retry.
      sources.set(id, { state: 'failed', triples: 0, inferred: 0, ms: 0, error: error.message });
    }
    notify();
  }

  async function dropSource(id) {
    const kb = KNOWLEDGE_BASES.find((entry) => entry.id === id);
    if (!kb) return;
    wanted.delete(id);
    sources.set(id, { state: 'idle', triples: 0, inferred: 0, ms: 0, error: null });
    notify();
    if (worker) await send('dropKg', { graphName: kb.graph }).catch(() => {});
  }

  return {
    sources: sourcesSnapshot,

    /** The knowledge bases whose prefixes belong in the preamble. */
    loadedSources() {
      return sourcesSnapshot().filter((kb) => kb.state === 'ready');
    },

    isRunning: () => !!running,

    toggleSource(id) {
      const current = sources.get(id);
      return current?.state === 'ready' || current?.state === 'loading'
        ? dropSource(id)
        : loadSource(id);
    },

    loadSource,

    /** Warms the engine so the first query is not also the first wasm compile. */
    prewarm() {
      return send('init', {}).catch(() => {});
    },

    /**
     * Replaces the given document graphs in the engine.
     *
     * Called on Run, not on edit: the mermaid pane re-parses every 200 ms and the
     * engine has no interest in a document nobody has queried yet.
     */
    async syncGraphs(contributions) {
      const graphNames = contributions.map((c) => c.name);
      if (!graphNames.length) return;
      const quads = contributions.flatMap((c) => c.quads);
      await send('sync', { graphNames, nquads: await toNQuads(quads) });
    },

    async query(sparql, { maxRows = MAX_ROWS } = {}) {
      running = send('query', { sparql, maxRows });
      try {
        return await running;
      } finally {
        running = null;
      }
    },

    /**
     * Cancels by terminating the worker, because oxigraph's `query()` is a
     * synchronous wasm call with nothing to signal — there is no cooperative
     * cancellation to ask for. The knowledge bases are reloaded from the HTTP
     * cache, so the cost is roughly the parse, not the download.
     */
    async cancel() {
      if (!worker) return;
      worker.terminate();
      worker = null;
      for (const [, entry] of pending) entry.reject(new Error('query cancelled'));
      pending.clear();
      running = null;
      sources = initialStates();
      notify();
      await Promise.all([...wanted].map(loadSource));
    },
  };
}
