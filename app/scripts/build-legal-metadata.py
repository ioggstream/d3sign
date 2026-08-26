#!/usr/bin/env python3
"""Build app/src/data/legal-completions.json from the legal knowledge bases.

Completion and hover are synchronous keystroke paths: they cannot wait for the query
worker to fetch and parse a knowledge base, which is the same reason the three
d3fend-*.json projections exist (docs/adr/0020-sparql-query-engine.md). So the legal
vocabularies get the same treatment — a precomputed projection of exactly what a term
card shows, and nothing else.

The output is deliberately the *same item shape* as d3fend-completions.json:

    { "dpv": { "EncryptionAtRest": { "label": …, "kind": "class",
                                     "documentation": …, "parents": [ … ],
                                     "sources": [ { "label": …, "url": … } ] } },
      "ob":  { "nis2-art21-2-h":  { … } } }

so src/editor/d3fendHierarchy.js reads both through one code path. Grouped by prefix
because a local name is only unique within its namespace, and the editor knows which
prefix the user typed.

Only subjects carrying a skos:prefLabel or rdfs:label are emitted. Everything else in
DPV is metadata about the vocabulary — contributors, serialisations, concept schemes —
which no one hovers over, and which would roughly double the file.

A term's `dct:source` is a citation, and in DPV it is usually a *blank node* — a
schema:WebPage carrying schema:name and schema:url ("GDPR Art.4-2",
eur-lex.europa.eu/…). It is dereferenced here into `sources: [{label, url}]` rather
than tracked as a node. Stringifying the blank node instead put its rdflib-generated
id in the card ("(n27048014d4c94bef948a8119a70c7565b17)"), which said nothing to a
reader and, being regenerated on every parse, made this file a fresh git blob on
every rebuild. Literal and IRI sources go through the same field, so the card has one
citation shape to draw.

`parents` are emitted as qnames ("dpv:TechnicalMeasure"), not bare local names: DPV's
hierarchy crosses modules constantly (an eu-nis2 concept is skos:broader a risk: one),
so a bare name would be ambiguous. The hierarchy is read from skos:broader *and*
rdfs:subClassOf, because DPV uses skos:broader within a family and rdfs:subClassOf at
the top of one.

Usage:
    python3 app/scripts/build-legal-metadata.py

Run it after app/scripts/build-legal-kg.py, or after editing
app/public/kg/regulation.ttl. Without legal.ttl.gz it still emits the hand-authored
prefixes and says what is missing.

Requires: rdflib (pip install rdflib)
"""
import argparse
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

import rdflib
from rdflib.namespace import OWL, RDF, RDFS, SKOS

APP_DIR = Path(__file__).resolve().parent.parent
KG_DIR = APP_DIR / "public" / "kg"
OUTPUT_PATH = APP_DIR / "src" / "data" / "legal-completions.json"
# Kept out of legal-completions.json, and small, because the graph view imports it on
# every load to colour a node — exactly why d3fend-categories.json is separate from
# d3fend-completions.json rather than a field on it.
CATEGORIES_PATH = APP_DIR / "src" / "data" / "legal-categories.json"

# Must agree with QUERY_GRAPH_PREFIXES in app/src/query/queryPrefixes.js, which is the
# source of truth — app/test/vocabularies.test.js asserts that it does. A namespace
# absent here is simply not projected, so the editor stays silent about it rather than
# offering completions a query cannot name.
PREFIXES = {
    "dpv": "https://w3id.org/dpv#",
    "pd": "https://w3id.org/dpv/pd#",
    "risk": "https://w3id.org/dpv/risk#",
    "tech": "https://w3id.org/dpv/tech#",
    "eu-gdpr": "https://w3id.org/dpv/legal/eu/gdpr#",
    "eu-nis2": "https://w3id.org/dpv/legal/eu/nis2#",
    "eu-aiact": "https://w3id.org/dpv/legal/eu/aiact#",
    "ob": "urn:d3fend-graph:obl:",
    "al": "urn:d3fend-graph:align:",
}

# Longest namespace first, so dpv/risk# is not read as a term inside dpv#.
BY_LENGTH = sorted(PREFIXES.items(), key=lambda item: -len(item[1]))

PROPERTY_TYPES = {OWL.ObjectProperty, OWL.DatatypeProperty, OWL.AnnotationProperty, RDF.Property}

DCT_SOURCE = rdflib.URIRef("http://purl.org/dc/terms/source")
SCHEMA_NAME = rdflib.URIRef("https://schema.org/name")
SCHEMA_URL = rdflib.URIRef("https://schema.org/url")


def qname(uri):
    """"dpv:EncryptionAtRest" for a projected namespace, else None."""
    text = str(uri)
    for prefix, namespace in BY_LENGTH:
        if text.startswith(namespace):
            local = text[len(namespace):]
            # A slash or hash left over means this is a sub-namespace we do not
            # project, not a term in this one.
            return f"{prefix}:{local}" if local and "/" not in local and "#" not in local else None
    return None


def first(graph, subject, *predicates):
    """The first English-or-untagged *text* value among several predicates.

    Blank nodes are skipped rather than stringified: their `str()` is an rdflib-
    generated id, which is neither stable across parses nor meaningful to a reader.
    A blank node's content is reached by dereferencing it — see `sources`.
    """
    for predicate in predicates:
        values = [v for v in graph.objects(subject, predicate) if not isinstance(v, rdflib.BNode)]
        if not values:
            continue
        english = [v for v in values if getattr(v, "language", None) in ("en", None)]
        return str((english or values)[0]).strip()
    return None


def sources(graph, subject):
    """`dct:source` citations as [{"label", "url"}], dereferenced.

    The three shapes DPV uses, all flattened to the same pair:

      - a blank schema:WebPage — schema:name is the citation, schema:url the link;
      - a literal ("DGA 12.k", "GDPR Art. 35") — a citation with nowhere to go;
      - an IRI (the DPVCG group page) — its own label and link.

    Sorted by label, since a set of citations has no inherent order and this file is
    committed: iteration order would otherwise churn the diff.
    """
    out = {}
    for value in graph.objects(subject, DCT_SOURCE):
        if isinstance(value, rdflib.BNode):
            url = first(graph, value, SCHEMA_URL)
            label = first(graph, value, SCHEMA_NAME) or url
        elif isinstance(value, rdflib.URIRef):
            label = url = str(value)
        else:
            label, url = str(value).strip(), None
        if label:
            out[label] = {"label": label, "url": url} if url else {"label": label}
    return [out[label] for label in sorted(out)]


def read_graph(paths):
    graph = rdflib.Graph()
    for path in paths:
        if not path.exists():
            print(f"warning: {path} is missing — run build-legal-kg.py first", file=sys.stderr)
            continue
        text = (
            gzip.decompress(path.read_bytes()).decode("utf-8")
            if path.suffix == ".gz"
            else path.read_text(encoding="utf-8")
        )
        graph.parse(data=text, format="turtle")
        print(f"read {path.name}")
    return graph


# The DPV branches the graph view colours a node by, in priority order: the first one
# an ancestor walk reaches wins. They are the counterpart of D3FEND's four D3FENDCore
# branches in build-d3fend-categories.py, and only the branches a *diagram* can name
# are listed — `risk:` is not a typing vocabulary, so no drawn node is ever a Risk.
#
# Entity and Data come first because they are the two that fold onto an existing
# D3FEND colour (Agent and Artifact); the rest get their own.
FAMILY_ROOTS = [
    ("Entity", "dpv:Entity"),
    ("Data", "dpv:Data"),
    ("Measure", "dpv:TechnicalOrganisationalMeasure"),
    ("LegalBasis", "dpv:LegalBasis"),
    ("Purpose", "dpv:Purpose"),
    ("Process", "dpv:Process"),
]


def families(terms):
    """qname → the FAMILY_ROOTS branch it descends from, by walking `parents`.

    Breadth-first over the projection's own `parents` edges rather than the rdflib
    graph, so the answer cannot disagree with the hierarchy the hover card shows. DPV
    is a DAG — a term can reach two roots — so FAMILY_ROOTS order decides, and the
    walk is depth-bounded because DPV has cycles between a few punned terms.
    """
    parents_of = {
        f"{prefix}:{local}": item["parents"]
        for prefix, block in terms.items()
        for local, item in block.items()
    }
    # qname -> family, i.e. FAMILY_ROOTS inverted: the walk looks roots up by the qname
    # it has reached, not by the family name it is trying to find.
    roots = {qname: family for family, qname in FAMILY_ROOTS}
    priority = {family: rank for rank, (family, _) in enumerate(FAMILY_ROOTS)}
    out = {}

    for name in parents_of:
        seen, frontier, found = {name}, [name], None
        while frontier and not found:
            nxt = []
            # A whole level at a time, so a nearer root always beats a farther one.
            # Within one level several roots may be reachable — DPV is a DAG, not a
            # tree — so FAMILY_ROOTS order decides rather than iteration order.
            hits = [roots[c] for c in frontier if c in roots]
            if hits:
                found = min(hits, key=lambda family: priority[family])
                break
            for candidate in frontier:
                for parent in parents_of.get(candidate, ()):
                    if parent not in seen:
                        seen.add(parent)
                        nxt.append(parent)
            frontier = nxt
        if found:
            out[name] = found

    return dict(sorted(out.items()))


def build(graph):
    out = {prefix: {} for prefix in PREFIXES}

    for subject in set(graph.subjects()):
        if not isinstance(subject, rdflib.URIRef):
            continue
        name = qname(subject)
        if not name:
            continue

        label = first(graph, subject, SKOS.prefLabel, RDFS.label)
        if not label:
            # No label means nothing a card could show as a title, and in DPV means
            # this is vocabulary metadata rather than a term.
            continue

        definition = first(graph, subject, SKOS.definition, RDFS.comment)
        types = set(graph.objects(subject, RDF.type))
        parents = sorted(
            {
                parent
                for predicate in (SKOS.broader, RDFS.subClassOf)
                for target in graph.objects(subject, predicate)
                if isinstance(target, rdflib.URIRef) and (parent := qname(target))
            }
        )

        prefix, local = name.split(":", 1)
        item = {
            "label": label,
            "kind": "property" if types & PROPERTY_TYPES else "class",
            "documentation": definition or "",
            "parents": parents,
        }
        # Omitted when empty, so an uncited term costs no bytes — most of D3FEND's own
        # projection shape is optional the same way.
        citations = sources(graph, subject)
        if citations:
            item["sources"] = citations
        out[prefix][local] = item

    return {prefix: dict(sorted(terms.items())) for prefix, terms in out.items() if terms}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--kg-dir", type=Path, default=KG_DIR)
    parser.add_argument("--out", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--categories-out", type=Path, default=CATEGORIES_PATH)
    args = parser.parse_args()

    graph = read_graph([args.kg_dir / "legal.ttl.gz", args.kg_dir / "regulation.ttl"])
    if not len(graph):
        sys.exit("nothing was read — no vocabularies to project")

    result = build(graph)
    categories = families(result)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    with open(args.categories_out, "w") as handle:
        json.dump(categories, handle, indent=2, sort_keys=True)
        handle.write("\n")

    total = sum(len(terms) for terms in result.values())
    per_prefix = " · ".join(f"{prefix} {len(terms)}" for prefix, terms in sorted(result.items()))
    print(f"Wrote {total} terms to {args.out}")
    print(f"         {per_prefix}")

    counts = Counter(categories.values())
    per_family = " · ".join(f"{family} {n}" for family, n in sorted(counts.items()))
    print(f"Wrote {len(categories)} family assignments to {args.categories_out}")
    print(f"         {per_family or '(none — is dpv: in the knowledge base?)'}")
    missing = sorted(set(PREFIXES) - set(result))
    if missing:
        print(f"note: no terms found for {', '.join(missing)}", file=sys.stderr)


if __name__ == "__main__":
    main()
