#!/usr/bin/env python3
"""Build app/src/data/alignment.json from the hand-authored alignment.

The alignment — which D3FEND class speaks to which statutory duty, and why — lives in
Section 2 of app/public/kg/regulation.ttl as reified al:Mapping subjects
(docs/adr/0025-legal-knowledge-bases.md). Queries 09 to 13 read it from the SPARQL
engine, but the graph's node panel cannot: it renders synchronously on a double-click,
while K:regulation is fetched into the query worker only once the user ticks it in the
Sources chip. A panel whose contents depended on a checkbox in another pane would be a
worse surprise than no panel.

So the same trick as everywhere else in this folder — precompute exactly what the panel
shows (docs/adr/0020-sparql-query-engine.md). This one is cheap: regulation.ttl is a few
hundred committed, plain, hand-edited lines, so there is no download and no gzip.

Output shape:

    { "byD3fendClass": {
        "d3f:MessageEncryption": [
          { "legalConcept": "dpv:EncryptionInTransfer",
            "obligation": "ob:nis2-art21-2-h",
            "obligationLabel": "Policies and procedures regarding the use of …",
            "instrument": "NIS2 Directive",
            "strength": "Partial",
            "rationale": "Covers the cryptography-in-transit half of (h) …",
            "reviewStatus": "Draft",
            "source": "NIS2 Article 21(2)(h)" } ] },
      "byLegalConcept": { "dpv:EncryptionInTransfer": ["d3f:MessageEncryption"] } }

`byLegalConcept` is the reverse index, so a node typed only in DPV can still find the
D3FEND classes the alignment ties it to. It is derived here rather than in the browser
because the panel would otherwise rebuild it on every open.

Every entry carries `reviewStatus`, and the panel must show it: each mapping is
engineering judgement about a statutory duty, seeded as al:Draft, and presenting one as
settled fact is the failure mode ADR 0025 spent a section on.

Usage:
    python3 app/scripts/build-alignment-metadata.py

Run it after editing app/public/kg/regulation.ttl.

Requires: rdflib (pip install rdflib)
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import rdflib
from rdflib.namespace import RDF, RDFS, SKOS

APP_DIR = Path(__file__).resolve().parent.parent
KG_DIR = APP_DIR / "public" / "kg"
OUTPUT_PATH = APP_DIR / "src" / "data" / "alignment.json"

# Must agree with QUERY_GRAPH_PREFIXES in app/src/query/queryPrefixes.js and with
# PREFIXES in build-legal-metadata.py. Only the namespaces a mapping can name are
# here — al: and ob: for its own parts, d3f:/dpv:/pd: for the two ends it joins.
PREFIXES = {
    "d3f": "http://d3fend.mitre.org/ontologies/d3fend.owl#",
    "dpv": "https://w3id.org/dpv#",
    "pd": "https://w3id.org/dpv/pd#",
    "ob": "urn:d3fend-graph:obl:",
    "al": "urn:d3fend-graph:align:",
}
BY_LENGTH = sorted(PREFIXES.items(), key=lambda item: -len(item[1]))

AL = rdflib.Namespace(PREFIXES["al"])
OB = rdflib.Namespace(PREFIXES["ob"])
DCT_SOURCE = rdflib.URIRef("http://purl.org/dc/terms/source")


def qname(uri):
    """"d3f:MessageEncryption" for a projected namespace, else None."""
    if not isinstance(uri, rdflib.URIRef):
        return None
    text = str(uri)
    for prefix, namespace in BY_LENGTH:
        if text.startswith(namespace):
            local = text[len(namespace):]
            return f"{prefix}:{local}" if local else None
    return None


def first(graph, subject, *predicates):
    """The first English-or-untagged value among several predicates."""
    for predicate in predicates:
        values = list(graph.objects(subject, predicate))
        if not values:
            continue
        english = [v for v in values if getattr(v, "language", None) in ("en", None)]
        return str((english or values)[0]).strip()
    return None


def local_name(uri):
    """The bare local name of an al: concept — al:Partial -> "Partial"."""
    name = qname(uri)
    return name.split(":", 1)[1] if name else None


def build(graph):
    by_class = {}
    skipped = Counter()

    for mapping in sorted(graph.subjects(RDF.type, AL.Mapping)):
        d3fend_class = qname(graph.value(mapping, AL["d3fend-class"]))
        obligation = graph.value(mapping, AL.obligation)
        rationale = first(graph, mapping, AL.rationale)

        # All three are load-bearing. A mapping without a rationale is the thing ADR
        # 0025 made mandatory; one without both ends joins nothing. Counting rather
        # than crashing, because a half-written mapping in a hand-edited file should
        # not stop the projection — but it must be reported, not swallowed.
        if not d3fend_class or not obligation or not rationale:
            skipped[
                "no d3fend-class" if not d3fend_class
                else "no obligation" if not obligation
                else "no rationale"
            ] += 1
            continue

        instrument = graph.value(obligation, OB.instrument)
        by_class.setdefault(d3fend_class, []).append(
            {
                "legalConcept": qname(graph.value(mapping, AL["legal-concept"])),
                "obligation": qname(obligation),
                "obligationLabel": first(graph, obligation, SKOS.prefLabel, RDFS.label),
                "instrument": first(graph, instrument, SKOS.prefLabel, RDFS.label) if instrument else None,
                "strength": local_name(graph.value(mapping, AL.strength)),
                "rationale": rationale,
                "reviewStatus": local_name(graph.value(mapping, AL["review-status"])),
                "source": first(graph, mapping, DCT_SOURCE),
            }
        )

    # Stable order inside a class, so a rebuild is a no-op in git: strongest claim
    # first, then by obligation so the tie-break is not rdflib's set iteration.
    rank = {"Full": 0, "Partial": 1, "Supporting": 2}
    for entries in by_class.values():
        entries.sort(key=lambda e: (rank.get(e["strength"], 9), e["obligation"] or ""))

    by_concept = {}
    for d3fend_class, entries in by_class.items():
        for entry in entries:
            if entry["legalConcept"]:
                by_concept.setdefault(entry["legalConcept"], set()).add(d3fend_class)

    return {
        "byD3fendClass": dict(sorted(by_class.items())),
        "byLegalConcept": {concept: sorted(classes) for concept, classes in sorted(by_concept.items())},
    }, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--kg-dir", type=Path, default=KG_DIR)
    parser.add_argument("--out", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    source = args.kg_dir / "regulation.ttl"
    if not source.exists():
        sys.exit(f"{source} is missing — it is committed, so this is a broken checkout")

    graph = rdflib.Graph()
    graph.parse(str(source), format="turtle")

    result, skipped = build(graph)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")

    mappings = sum(len(entries) for entries in result["byD3fendClass"].values())
    print(f"Wrote {mappings} mappings over {len(result['byD3fendClass'])} D3FEND classes to {args.out}")
    print(f"         {len(result['byLegalConcept'])} DPV concepts in the reverse index")
    for reason, count in sorted(skipped.items()):
        print(f"warning: skipped {count} al:Mapping with {reason}", file=sys.stderr)


if __name__ == "__main__":
    main()
