/**
 * Rebuilds n3 quads from the flattened terms the worker posts back.
 *
 * The crossing point between the two RDF representations in the app: the engine
 * side speaks plain objects because that is what survives `postMessage`, and the
 * document side speaks n3 quads because that is what the store, the serializer and
 * the graph model take. A CONSTRUCT result that becomes a drawn named graph has to
 * come back across.
 */

import { DataFactory } from 'n3';

const { namedNode, blankNode, literal, quad } = DataFactory;

function termFrom(flat) {
  if (!flat) return null;
  switch (flat.termType) {
    case 'NamedNode':
      return namedNode(flat.value);
    case 'BlankNode':
      return blankNode(flat.value);
    case 'Literal':
      // Language wins over datatype: a language-tagged literal's datatype is always
      // rdf:langString, and passing both to n3 produces a term that serializes wrong.
      if (flat.language) return literal(flat.value, flat.language);
      return flat.datatype ? literal(flat.value, namedNode(flat.datatype)) : literal(flat.value);
    default:
      return null;
  }
}

/**
 * One quad, forced into `graphName`.
 *
 * The CONSTRUCT's own graph term is discarded on purpose: the result is being added
 * to the document as one named graph, and that name is the user's, not the query's.
 * Returns null for a quad whose subject, predicate or object did not survive —
 * a caller should drop it rather than build a broken triple.
 */
export function quadFromFlat(flat, graphName) {
  const subject = termFrom(flat.subject);
  const predicate = termFrom(flat.predicate);
  const object = termFrom(flat.object);
  if (!subject || !predicate || !object) return null;
  // A literal subject or predicate is not RDF, whatever the engine returned.
  if (subject.termType === 'Literal' || predicate.termType !== 'NamedNode') return null;
  return quad(subject, predicate, object, namedNode(graphName));
}

/** Every convertible quad of a CONSTRUCT result, tagged with `graphName`. */
export function quadsFromFlat(flats, graphName) {
  return flats.map((flat) => quadFromFlat(flat, graphName)).filter(Boolean);
}
