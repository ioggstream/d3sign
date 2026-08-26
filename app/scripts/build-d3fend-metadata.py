#!/usr/bin/env python3
"""Build app/src/data/d3fend-metadata.json from the D3FEND OWL ontology.

For every owl:Class in d3fend.ttl that also appears in
app/src/data/d3fend-categories.json (i.e. reaches one of the D3FENDCore
top branches), emit its definition, canonical id, deprecated flag,
kill-chain tactics and artifact/technique relations, keyed by local name:

    "AccessControlList": {
      "label": "Access Control List",
      "definition": "...",
      "d3fendId": "d3f:d3f:00123",
      "deprecated": false,
      "killChain": ["Harden"],
      "offensive": true,   # only on offensive techniques; absent means false
      "relations": [{"predicate": "d3f:hardens", "direction": "out", "targetLocalName": "...", "kind": "defense"}]
    }

`kind` is the partner class, not the relation: "attack" when the partner is an
offensive technique, "defense" when it is a d3f:DefensiveTechnique, "related"
otherwise (User has-account UserAccount is neither). The same offensive set is
what `offensive` reports, so the graph's colour and the panel's sections agree.

Relations are read from direct triples *and* from the OWL restrictions the
ontology states them with, which is where most of them live - see
materialize_restrictions().

Target of a relation is stored as a local name only, resolved against the
live RDF store at render time, so the panel never shows stale labels if the
ontology is updated independently of a loaded diagram.

Usage:
    python3 app/scripts/build-d3fend-metadata.py /path/to/d3fend.ttl[.gz]

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

CATEGORIES_PATH = (
    Path(__file__).resolve().parent.parent / "src" / "data" / "d3fend-categories.json"
)
OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "src" / "data" / "d3fend-metadata.json"
)

# Predicates that describe class metadata rather than a technique/artifact
# relation - excluded when scanning a class's outgoing/incoming edges for
# relations. Everything else under the d3f: namespace is treated as a
# relation verb (analyzes, hardens, restores, accesses, reads, ... - the
# real set is too large and open-ended to enumerate, confirmed against
# d3fend.ttl: 25+ distinct verbs appear between defensive techniques and
# artifacts alone).
METADATA_PREDICATES = {
    "definition", "attack-id", "d3fend-id", "deprecated", "seeAlso",
    "kb-reference", "kb-article", "synonym", "altLabel", "cwe-id",
    "display-order", "isDefinedBy", "enables", "weakness-of",
}

# `enables` links technique -> tactic (verified against d3fend.ttl), e.g.
# `T1068 enables TA0004`, `MessageHardening enables Harden` - NOT the
# reverse.
TACTIC_RELATION = "enables"


def local_name(uri):
    return str(uri).split("#")[-1]


def first_literal(g, subject, predicate):
    for obj in g.objects(subject, predicate):
        return str(obj)
    return None


def parse_graph(ttl_path: Path) -> rdflib.Graph:
    """Parses turtle, gzipped or not - the vendored copy is app/public/kg/d3fend.ttl.gz."""
    g = rdflib.Graph()
    if ttl_path.suffix == ".gz":
        with gzip.open(ttl_path) as f:
            g.parse(f, format="turtle")
    else:
        g.parse(str(ttl_path), format="turtle")
    return g


def materialize_restrictions(g):
    """Flattens `?c rdfs:subClassOf [ owl:onProperty ?p ; owl:someValuesFrom ?t ]`
    into `(?c, ?p, ?t)`.

    D3FEND states most of its relations this way rather than as direct triples
    (1787 vs. a few hundred, and d3f:preceded-by exists *only* in restriction
    form), so a panel fed by direct triples alone shows almost nothing for a
    plain artifact. The SPARQL pane already does this at load time
    (app/src/query/queryEngine.js, MATERIALIZE_RESTRICTIONS); this is the same
    rewrite, so the two views agree on what the ontology says.
    """
    triples = []
    for cls, restriction in g.subject_objects(RDFS.subClassOf):
        if not isinstance(cls, rdflib.URIRef):
            continue
        predicate = g.value(restriction, OWL.onProperty)
        if predicate is None:
            continue
        target = g.value(restriction, OWL.someValuesFrom) or g.value(
            restriction, OWL.allValuesFrom
        )
        if not isinstance(target, rdflib.URIRef) or not isinstance(predicate, rdflib.URIRef):
            continue
        triples.append((cls, predicate, target))
    return triples


def build(ttl_path: Path, known_classes: set) -> dict:
    g = parse_graph(ttl_path)

    classes = {c for c in g.subjects(RDF.type, OWL.Class) if local_name(c) in known_classes}

    # Restrictions indexed both ways, so the outgoing and the incoming scan can
    # each consult them the way they consult the direct triples.
    restrictions_by_subject = {}
    restrictions_by_object = {}
    for subject, predicate, obj in materialize_restrictions(g):
        restrictions_by_subject.setdefault(subject, []).append((predicate, obj))
        restrictions_by_object.setdefault(obj, []).append((subject, predicate))

    # Every class under d3f:DefensiveTechnique. What makes a relation a *defense*
    # is the partner being a countermeasure, not merely not being an attack:
    # `User has-account UserAccount` is neither.
    defensive_techniques = set(g.transitive_subjects(RDFS.subClassOf, D3F.DefensiveTechnique))

    # Offensive classes, which the graph draws in its own colour and the panel
    # lists under Attack. Two sources, because neither covers the other: the
    # d3f:OffensiveTechnique closure holds the 15 abstract tactic parents that
    # carry no id, and an attack-id reaches the 633 techniques of the frameworks
    # outside that closure (ATLAS `AML.T*`, ICS `T0*`, `EXF-*`).
    offensive_techniques = set(g.transitive_subjects(RDFS.subClassOf, D3F.OffensiveTechnique)) | {
        c for c in g.subjects(RDF.type, OWL.Class) if first_literal(g, c, D3F["attack-id"])
    }

    # technique -> [tactic] via `enables` (subject=technique, object=tactic).
    technique_to_tactics = {}
    for technique, tactic in g.subject_objects(D3F[TACTIC_RELATION]):
        technique_to_tactics.setdefault(technique, set()).add(tactic)

    def is_relation_predicate(predicate_uri):
        if not str(predicate_uri).startswith(D3FEND_NS):
            return False
        return local_name(predicate_uri) not in METADATA_PREDICATES

    def classify(cls_uri):
        """attack (an offensive technique), defense (a d3f:DefensiveTechnique), or related."""
        if cls_uri in offensive_techniques:
            return "attack"
        return "defense" if cls_uri in defensive_techniques else "related"

    out = {}
    for c in sorted(classes, key=local_name):
        name = local_name(c)
        entry = {
            "label": first_literal(g, c, RDFS.label) or name,
            "definition": first_literal(g, c, D3F.definition) or first_literal(g, c, RDFS.comment),
            "d3fendId": first_literal(g, c, D3F["d3fend-id"]),
            "deprecated": bool(first_literal(g, c, OWL.deprecated) == "true"),
            "killChain": sorted(local_name(t) for t in technique_to_tactics.get(c, [])),
            "relations": [],
        }
        # Only when true: the graph reads it to colour a node as an attack, and
        # "absent means no" keeps 3000 `false`s out of the file.
        if c in offensive_techniques:
            entry["offensive"] = True

        # The same relation is often stated twice - as a direct triple and as a
        # restriction - so rows are deduplicated on what the panel draws.
        seen = set()

        def add(predicate, partner, direction):
            if not is_relation_predicate(predicate) or partner not in classes:
                return
            key = (local_name(predicate), direction, local_name(partner))
            if key in seen:
                return
            seen.add(key)
            entry["relations"].append(
                {
                    "predicate": f"d3f:{local_name(predicate)}",
                    "direction": direction,
                    "targetLocalName": local_name(partner),
                    "kind": classify(partner),
                }
            )

        # Outgoing: this class acts on another known class, e.g. a technique on an
        # artifact, or an artifact on the account it belongs to.
        for predicate, obj in g.predicate_objects(c):
            add(predicate, obj, "out")
        for predicate, obj in restrictions_by_subject.get(c, ()):
            add(predicate, obj, "out")

        # Incoming: another known class acts on this one.
        for subject, predicate in g.subject_predicates(c):
            add(predicate, subject, "in")
        for subject, predicate in restrictions_by_object.get(c, ()):
            add(predicate, subject, "in")

        out[name] = entry

    return dict(sorted(out.items()))


def main():
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} /path/to/d3fend.ttl[.gz]", file=sys.stderr)
        sys.exit(1)

    ttl_path = Path(sys.argv[1])
    known_classes = set(json.loads(CATEGORIES_PATH.read_text()).keys())
    result = build(ttl_path, known_classes)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    print(f"Wrote {len(result)} classes to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
