/**
 * The SPARQL engine adapter.
 *
 * The oxigraph module is injected rather than imported, because the browser and
 * node entry points differ (`oxigraph/web.js` needs an explicit `init(wasmUrl)`,
 * `oxigraph` under node does not). That injection is also what lets
 * app/test/query-engine.test.js drive real SPARQL headlessly without a Worker —
 * the engine is the one piece of this feature that cannot be made pure, so it is
 * at least made callable.
 *
 * Everything here is engine-shaped but result-agnostic: terms are flattened to
 * plain RDF/JS-ish objects so they survive `postMessage` and so resultModel.js
 * never learns which engine ran.
 */

/**
 * Rows the engine will return at most. Well above any sane query and far below
 * what would wedge the tab: `SELECT * WHERE {?s ?p ?o}` over the ontology is
 * ~130k rows, and posting them all only to cap the table at 500 is pure waste.
 */
export const MAX_ROWS = 5000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function flattenTerm(term) {
  if (!term) return null;
  const termType = term.termType;
  if (termType === 'Literal') {
    return {
      termType,
      value: term.value,
      language: term.language || '',
      // A NamedNode in every version; stringified so it survives postMessage.
      datatype: term.datatype ? term.datatype.value : '',
    };
  }
  // DefaultGraph carries no useful value and would render as an empty cell anyway.
  if (termType === 'DefaultGraph') return null;
  return { termType, value: term.value };
}

/**
 * SELECT bindings arrive as a Map per row in current oxigraph, and as a plain
 * object in older builds. Both are handled because the difference is invisible
 * until it produces a table of empty cells.
 */
function flattenBindings(binding, vars) {
  const row = {};
  for (const name of vars) {
    const term = typeof binding?.get === 'function' ? binding.get(name) : binding?.[name];
    const flat = flattenTerm(term);
    if (flat) row[name] = flat;
  }
  return row;
}

/**
 * Column names of a SELECT projection list.
 *
 * An expression projection is named by its alias *only*: `(COUNT(?s) AS ?total)`
 * is one column called `total`, and the `?s` inside it is not a column at all.
 * Scanning by paren depth rather than matching a regex over the whole list is
 * what keeps the inner variables out — they are the operands of the expression,
 * and an aggregate's operand is never in the result.
 */
function projectionNames(list) {
  const names = [];
  let depth = 0;
  let alias = null;
  const token = /\(|\)|\bAS\b|\?(\w+)/gi;
  for (const m of list.matchAll(token)) {
    if (m[0] === '(') {
      depth += 1;
      if (depth === 1) alias = null;
    } else if (m[0] === ')') {
      depth -= 1;
      if (depth === 0 && alias) names.push(alias);
    } else if (m[0].toUpperCase() === 'AS') {
      alias = '';
    } else if (depth === 0) {
      names.push(m[1]);
    } else if (alias === '') {
      // The variable right after AS, at any depth inside the projection.
      alias = m[1];
    }
  }
  return [...new Set(names)];
}

/**
 * Variable names in result order.
 *
 * Taken from the query text rather than the bindings: a variable that is unbound
 * in every row still deserves its column, and `SELECT *` has no list to read.
 */
function variableOrder(sparql, rows) {
  const selectStar = /\bSELECT\s+(?:(?:DISTINCT|REDUCED)\s+)?\*/i.test(sparql);
  if (!selectStar) {
    // WHERE is optional in SPARQL (`SELECT ?a { … }`); such a query falls through
    // to the bindings below, which loses only the order of unbound columns.
    const match = sparql.match(/\bSELECT\s+(?:(?:DISTINCT|REDUCED)\s+)?([\s\S]*?)\bWHERE\b/i);
    if (match) {
      const unique = projectionNames(match[1]);
      if (unique.length) return unique;
    }
  }
  const seen = new Set();
  for (const row of rows) {
    const keys = typeof row?.keys === 'function' ? row.keys() : Object.keys(row ?? {});
    for (const key of keys) seen.add(key);
  }
  return [...seen];
}

function loadInto(oxigraph, store, text, format, graphName) {
  const options = { format };
  if (graphName) options.to_graph_name = oxigraph.namedNode(graphName);
  try {
    store.load(text, options);
  } catch (error) {
    // oxigraph 0.3 took (data, mimeType, baseIRI, toGraphName) positionally; 0.4
    // takes an options object. Retrying beats a cryptic wasm error, and a hard
    // failure here names the real problem.
    try {
      store.load(text, format, null, graphName ? oxigraph.namedNode(graphName) : undefined);
    } catch {
      throw new Error(
        `oxigraph rejected a ${format} load (${error?.message ?? error}). ` +
          'Check the pinned oxigraph version: Store.load() changed signature between 0.3 and 0.4.',
      );
    }
  }
}

/**
 * Flattens OWL existential restrictions into the direct triples queries expect.
 *
 * D3FEND states a relation as
 *
 *     d3f:CredentialScrubbing rdfs:subClassOf
 *       [ a owl:Restriction ; owl:onProperty d3f:hardens ;
 *         owl:someValuesFrom d3f:Subroutine ] .
 *
 * and *usually* also asserts `d3f:hardens d3f:Subroutine` directly — but not
 * always, and never uniformly: in d3fend.ttl `d3f:preceded-by` has 115 restrictions
 * and no direct triples at all, `d3f:has-participant` 144 against 3. A query reading
 * only direct triples therefore under-reports, silently and unevenly, which is the
 * worst failure this feature has: an empty row set reads as "no findings".
 *
 * Materializing once at load beats a UNION in every query — the alternative is
 * every canned query, and every query a user writes, having to know this.
 *
 * Only `someValuesFrom` and `allValuesFrom` on `owl:onProperty`, attached through
 * `rdfs:subClassOf`: that is the entire vocabulary d3fend.ttl uses (1787 of 1788
 * restrictions are `someValuesFrom`, one is `allValuesFrom`, and there is no
 * cardinality, `hasValue`, `onClass` or `equivalentClass` anywhere in it). Blank
 * targets are skipped — a nested restriction is not a relation.
 */
const MATERIALIZE_RESTRICTIONS = `
PREFIX owl:  <http://www.w3.org/2002/07/owl#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
INSERT { GRAPH %G% { ?class ?property ?target } }
WHERE {
  GRAPH %G% {
    ?class rdfs:subClassOf ?restriction .
    ?restriction owl:onProperty ?property .
    { ?restriction owl:someValuesFrom ?target } UNION { ?restriction owl:allValuesFrom ?target }
  }
  FILTER(isIRI(?class) && isIRI(?property) && isIRI(?target))
}`;

export function createQueryEngine(oxigraph) {
  const store = new oxigraph.Store();
  /** graph name -> triple count, for the Sources chip. */
  const loaded = new Map();

  function clearGraph(graphName) {
    store.update(`CLEAR SILENT GRAPH <${graphName}>`);
  }

  function countGraph(graphName) {
    const rows = store.query(`SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${graphName}> { ?s ?p ?o } }`);
    const term = typeof rows[0]?.get === 'function' ? rows[0].get('n') : rows[0]?.n;
    return Number(term?.value ?? 0);
  }

  return {
    /**
     * Loads a knowledge base's turtle into its own graph, replacing what was there,
     * then flattens its OWL restrictions into direct triples.
     *
     * `inferred` is reported separately so the Sources chip can show it: a number
     * there is the difference between queries that find the ontology's relations and
     * queries that quietly find a fraction of them.
     */
    loadTurtle(graphName, turtle) {
      const started = now();
      clearGraph(graphName);
      loadInto(oxigraph, store, turtle, 'text/turtle', graphName);
      const parsed = countGraph(graphName);
      store.update(MATERIALIZE_RESTRICTIONS.replaceAll('%G%', `<${graphName}>`));
      const triples = countGraph(graphName);
      loaded.set(graphName, triples);
      return { graphName, triples, inferred: triples - parsed, ms: now() - started };
    },

    /**
     * Replaces the named graphs the document just changed.
     *
     * N-Quads rather than a quad array because the quads already carry their graph
     * and oxigraph parses the format natively — a few hundred document quads is
     * ~80 KB of text either way, and this needs no term marshalling.
     */
    syncGraphs(graphNames, nquads) {
      for (const name of graphNames) clearGraph(name);
      if (nquads?.trim()) loadInto(oxigraph, store, nquads, 'application/n-quads', null);
      return graphNames.length;
    },

    dropGraph(graphName) {
      clearGraph(graphName);
      loaded.delete(graphName);
    },

    loadedGraphs() {
      return Object.fromEntries(loaded);
    },

    /**
     * Runs a query and flattens whatever came back.
     *
     * `truncated` is the honest signal that the cap bit: the alternative is a
     * table that looks like a complete answer and is not.
     */
    query(sparql, { maxRows = MAX_ROWS } = {}) {
      const started = now();
      const raw = store.query(sparql);
      const ms = now() - started;

      if (typeof raw === 'boolean') return { kind: 'ask', boolean: raw, ms };

      // A quad by shape as well as by termType: RDF/JS says `termType: 'Quad'`, but
      // this is the one place a wrong guess produces a plausible-looking empty table
      // rather than an error, so it is not worth relying on a single marker.
      const isQuad = (value) => value?.termType === 'Quad' || (value && 'subject' in value && 'predicate' in value);

      if (Array.isArray(raw) && raw.length && isQuad(raw[0])) {
        return {
          kind: 'construct',
          quads: raw.slice(0, maxRows).map((q) => ({
            subject: flattenTerm(q.subject),
            predicate: flattenTerm(q.predicate),
            object: flattenTerm(q.object),
            graph: flattenTerm(q.graph),
          })),
          truncated: raw.length > maxRows,
          ms,
        };
      }

      const rows = Array.isArray(raw) ? raw : [];
      // An empty CONSTRUCT is indistinguishable from an empty SELECT in the
      // result alone, so the query form decides.
      if (!rows.length && /\b(CONSTRUCT|DESCRIBE)\b/i.test(sparql)) {
        return { kind: 'construct', quads: [], truncated: false, ms };
      }

      const vars = variableOrder(sparql, rows);
      return {
        kind: 'select',
        vars,
        rows: rows.slice(0, maxRows).map((binding) => flattenBindings(binding, vars)),
        truncated: rows.length > maxRows,
        ms,
      };
    },
  };
}
