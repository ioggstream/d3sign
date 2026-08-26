#!/usr/bin/env python3
"""Build app/src/data/d3fend-categories.json from the D3FEND OWL ontology.

For every owl:Class in d3fend.ttl, walk up rdfs:subClassOf (a DAG, so a
class may have multiple parents/paths) until reaching one or more of the
14 direct children of d3f:D3FENDCore. Classes that never reach one of
those 14 "top branches" (e.g. the D3FENDKBThing / ATT&CK-reference side
hierarchy) are omitted.

Usage:
    python3 app/scripts/build-d3fend-categories.py /path/to/d3fend.ttl[.gz]

Output is written to app/src/data/d3fend-categories.json, mapping each
class's local name to a sorted list of its top-branch local names, e.g.:

    "User": ["Agent", "Artifact"],
    "CodeRepository": ["Artifact"],

Requires: rdflib (pip install rdflib)
"""
import gzip
import json
import sys
from pathlib import Path

import rdflib
from rdflib.namespace import OWL, RDF, RDFS

D3FEND_NS = "http://d3fend.mitre.org/ontologies/d3fend.owl#"
CORE = rdflib.URIRef(D3FEND_NS + "D3FENDCore")

OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "src" / "data" / "d3fend-categories.json"
)


def local_name(uri):
    return str(uri).split("#")[-1]


def named(terms):
    """Keep only URIRefs.

    Anonymous class expressions are typed `owl:Class` and superclass
    restrictions appear as `rdfs:subClassOf [ a owl:Restriction ; ... ]`, so
    both queries below yield blank nodes, whose `local_name` is a generated id
    rather than a class name.
    """
    return (t for t in terms if isinstance(t, rdflib.URIRef))


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

    # 14 direct children of D3FENDCore act as the "top branches".
    core_children = set(g.subjects(RDFS.subClassOf, CORE))

    classes = set(g.subjects(RDF.type, OWL.Class))

    parents = {c: list(g.objects(c, RDFS.subClassOf)) for c in classes}

    memo = {}

    def resolve(c, visiting=frozenset()):
        if c in memo:
            return memo[c]
        if c in core_children:
            memo[c] = {c}
            return memo[c]
        if c in visiting:
            return set()
        visiting = visiting | {c}
        result = set()
        for p in parents.get(c, []):
            result |= resolve(p, visiting)
        memo[c] = result
        return result

    out = {}
    for c in classes:
        branches = resolve(c)
        if branches:
            out[local_name(c)] = sorted(local_name(b) for b in branches)

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

    print(f"Wrote {len(result)} classes to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
