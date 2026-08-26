#!/usr/bin/env python3
"""Build app/src/data/d3fend-completions.json from the D3FEND OWL ontology.

For every owl:Class and object/annotation property in d3fend.ttl, emit an
editor-completion entry keyed by local name:

    "Vulnerability": {
      "label": "Vulnerability",
      "kind": "class",
      "documentation": "A Vulnerability is a publicly disclosed instance ...",
      "parents": ["D3FENDCore"],
      "inverseOf": null,
      "characteristics": []
    }

`parents` holds direct rdfs:subClassOf/rdfs:subPropertyOf local names (not
the full ancestor chain) so the editor can walk the hierarchy interactively,
mirroring vscode-d3fend-language's hierarchy browser without depending on
that project's build pipeline.

Usage:
    python3 app/scripts/build-d3fend-completions.py /path/to/d3fend.ttl[.gz]

Requires: rdflib (pip install rdflib)
"""
import gzip
import json
import sys
from pathlib import Path

import rdflib
from rdflib.namespace import OWL, RDF, RDFS

D3FEND_NS = "http://d3fend.mitre.org/ontologies/d3fend.owl#"
D3F = rdflib.Namespace(D3FEND_NS)

OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "src" / "data" / "d3fend-completions.json"
)

PROPERTY_TYPES = (OWL.ObjectProperty, OWL.DatatypeProperty, OWL.AnnotationProperty)


def local_name(uri):
    return str(uri).split("#")[-1]


def named(terms):
    """Keep only URIRefs.

    OWL states anonymous class expressions (owl:unionOf, owl:intersectionOf)
    as `[ a owl:Class ; ... ]` and superclass restrictions as
    `rdfs:subClassOf [ a owl:Restriction ; ... ]`, so both a class query and a
    parent query yield blank nodes. `local_name` on one returns its generated
    id (`n7c2c1163...`, no `#` to split on), which then reaches the editor as
    a bogus class name.
    """
    return (t for t in terms if isinstance(t, rdflib.URIRef))


def first_literal(g, subject, predicate):
    for obj in g.objects(subject, predicate):
        return str(obj)
    return None


def parse_graph(ttl_path: Path) -> rdflib.Graph:
    """Parses turtle, gzipped or not - the vendored copy is app/public/kg/d3fend.ttl.gz.

    Same helper as build-d3fend-metadata.py. Without it this script could not read the
    one D3FEND file the repo actually commits, so a rebuild needed a plain d3fend.ttl
    from somewhere else — see scripts/rebuild-data.sh.
    """
    g = rdflib.Graph()
    if ttl_path.suffix == ".gz":
        with gzip.open(ttl_path) as f:
            g.parse(f, format="turtle")
    else:
        g.parse(str(ttl_path), format="turtle")
    return g


def build(ttl_path: Path) -> dict:
    g = parse_graph(ttl_path)

    classes = set(named(g.subjects(RDF.type, OWL.Class)))
    properties = set()
    for prop_type in PROPERTY_TYPES:
        properties |= set(named(g.subjects(RDF.type, prop_type)))

    transitive = set(g.subjects(RDF.type, OWL.TransitiveProperty))
    symmetric = set(g.subjects(RDF.type, OWL.SymmetricProperty))

    out = {}

    for c in classes:
        name = local_name(c)
        out[name] = {
            "label": first_literal(g, c, RDFS.label) or name,
            "kind": "class",
            "documentation": first_literal(g, c, D3F.definition)
            or first_literal(g, c, RDFS.comment)
            or "",
            "parents": sorted(
                {local_name(p) for p in named(g.objects(c, RDFS.subClassOf))}
            ),
            "inverseOf": None,
            "characteristics": [],
        }

    for p in properties:
        name = local_name(p)
        characteristics = []
        if p in transitive:
            characteristics.append("transitive")
        if p in symmetric:
            characteristics.append("symmetric")
        inverse = first_literal(g, p, OWL.inverseOf)
        out[name] = {
            "label": first_literal(g, p, RDFS.label) or name,
            "kind": "property",
            "documentation": first_literal(g, p, D3F.definition)
            or first_literal(g, p, RDFS.comment)
            or "",
            "parents": sorted(
                {local_name(sp) for sp in named(g.objects(p, RDFS.subPropertyOf))}
            ),
            "inverseOf": local_name(rdflib.URIRef(inverse)) if inverse else None,
            "characteristics": characteristics,
        }

    return dict(sorted(out.items()))


def main():
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} /path/to/d3fend.ttl[.gz]", file=sys.stderr)
        sys.exit(1)

    ttl_path = Path(sys.argv[1])
    result = build(ttl_path)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    print(f"Wrote {len(result)} entries to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
