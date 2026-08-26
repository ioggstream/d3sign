import { Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;

/**
 * Thin wrapper around N3.Store that supports cheap "replace this named
 * graph's quads" for live re-parsing, and change notifications for the
 * reactive turtle/graph panes.
 */
export class GraphStore {
  constructor() {
    this.store = new Store();
    this.listeners = new Set();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener(this);
  }

  replaceGraph(graphName, quads) {
    const graph = namedNode(graphName);
    const existing = this.store.getQuads(null, null, null, graph);
    for (const q of existing) this.store.removeQuad(q);
    this.store.addQuads(quads);
    this.notify();
  }

  addQuads(quads) {
    this.store.addQuads(quads);
    this.notify();
  }

  getQuads(graphName) {
    return graphName ? this.store.getQuads(null, null, null, namedNode(graphName)) : this.store.getQuads();
  }

  getSubjectQuads(iri) {
    return this.store.getQuads(namedNode(iri), null, null, null);
  }

  distinctPredicates(graphName) {
    const preds = new Set();
    for (const q of this.getQuads(graphName)) preds.add(q.predicate.value);
    return [...preds];
  }
}
