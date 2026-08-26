#!/usr/bin/env python3
"""Build app/public/kg/legal.ttl.gz from the W3C DPV 2.3 modules.

The knowledge base behind the legal queries: the Data Privacy Vocabulary, its
risk and tech modules, and the EU legal extensions for GDPR, NIS2 and the AI Act
(docs/adr/0025-legal-knowledge-bases.md).

The modules are concatenated *verbatim*, which is the whole design:

  - Turtle allows a prefix to be redeclared mid-document, none of the modules
    uses @base or a relative IRI, and no prefix label is bound to two different
    IRIs across them, so plain concatenation is valid Turtle.
  - It is byte-stable for free — the bytes are upstream's bytes — so rebuilding
    does not add a fresh blob to git history.
  - It keeps the upstream dct:creator/contributor/license triples, i.e. DPV's
    CC-BY-4.0 attribution, which a pruning pass would delete.
  - Nothing is gained by pruning: the editorial triples compress to almost
    nothing. Measured, verbatim concatenation gzips *smaller* (165 KB) than
    pruning and re-serialising through rdflib did (255 KB).

Blank nodes are left alone. Concatenation merges same-labelled blank nodes across
modules (`_:person-…` recurs), which is harmless deduplication of contributor
records; the ~145 survivors are bibliographic citation nodes.

All triples land in ONE named graph on load. A SPARQL property path is evaluated
inside a single GRAPH binding, and the EU modules hang their hierarchy off dpv:
and risk: terms, so splitting them would truncate every upward walk at the module
boundary and return a shorter, plausible-looking answer.

Usage:
    python3 app/scripts/build-legal-kg.py --source-dir /path/to/dpv/2.3
    python3 app/scripts/build-legal-kg.py --fetch --ref v2.3 --verify

Output is written to app/public/kg/legal.ttl.gz and is committed, so a clone runs
the legal queries with no build step.

Requires: nothing for the build. --verify requires rdflib (pip install rdflib).
"""
import argparse
import gzip
import hashlib
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
OUTPUT_PATH = APP_DIR / "public" / "kg" / "legal.ttl.gz"

RAW_BASE = "https://raw.githubusercontent.com/w3c/dpv/{ref}/2.3/{path}"
CACHE_DIR = Path.home() / ".cache" / "d3fend-graph" / "dpv"

# (short name, path under 2.3/). Order is the concatenation order: the vocabulary
# modules first, so a reader of the raw file meets dpv: before the extensions that
# specialise it. Adding a module — dga, ehds, rights, or a DORA one when the DPV CG
# publishes it — is one line here and a bump to `tripleHint` in
# app/src/rdf/knowledgeBases.js.
MODULES = [
    ("dpv", "dpv/dpv.ttl"),
    # The personal-data categories. Without it dpv:hasPersonalDataCategory points at
    # concepts the app does not hold: dpv.ttl already *mentions* pd:MedicalHealth,
    # pd:Biometric, pd:Genetic, pd:CurrentLocation and pd:GPSCoordinate as examples and
    # defines none of them, so "this flow carries health data" — the most useful thing a
    # GDPR diagram says — was unsayable.
    ("pd", "pd/pd.ttl"),
    ("risk", "risk/risk.ttl"),
    ("tech", "tech/tech.ttl"),
    ("gdpr", "legal/eu/gdpr/eu-gdpr.ttl"),
    ("nis2", "legal/eu/nis2/eu-nis2.ttl"),
    ("aiact", "legal/eu/aiact/eu-aiact.ttl"),
]


def module_paths(names):
    unknown = sorted(set(names) - {name for name, _ in MODULES})
    if unknown:
        sys.exit(f"unknown module(s): {', '.join(unknown)}")
    return [(name, path) for name, path in MODULES if name in names]


def read_local(source_dir: Path, name: str, path: str):
    candidate = source_dir / path
    if not candidate.exists():
        print(f"warning: {candidate} is missing, skipping {name}", file=sys.stderr)
        return None
    return candidate.read_text(encoding="utf-8"), str(candidate)


def read_fetched(ref: str, name: str, path: str, cache_dir: Path):
    """Download a module, or reuse the copy already in the cache.

    Cached per ref, so `--ref v2.3` and `--ref master` never mix in one build.
    """
    url = RAW_BASE.format(ref=ref, path=path)
    cached = cache_dir / ref / path
    if cached.exists():
        return cached.read_text(encoding="utf-8"), url

    try:
        with urllib.request.urlopen(url) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            print(f"warning: {url} is not there ({error.code}), skipping {name}", file=sys.stderr)
            return None
        raise

    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(body, encoding="utf-8")
    return body, url


def header(sources, ref):
    """The provenance block, as Turtle comments.

    Not decoration: it is the only human-readable record of where these bytes came
    from, and `--ref master` is mutable, so a file with no recorded ref cannot be
    reproduced. The attribution has to be repeated in the manifest entry and the
    README, because a gzipped comment is invisible.
    """
    lines = [
        "# W3C Data Privacy Vocabulary (DPV) 2.3 and its EU legal extensions.",
        "#",
        "# Generated by app/scripts/build-legal-kg.py — do not edit. The modules below",
        "# are concatenated verbatim; hand-authored obligations and D3FEND mappings live",
        "# in app/public/kg/regulation.ttl instead, so a rebuild cannot overwrite them.",
        "#",
        f"# Source: https://github.com/w3c/dpv at ref {ref}",
        f"# Retrieved: {date.today().isoformat()}",
        "# Licence: CC-BY-4.0, © the W3C Data Privacy Vocabularies and Controls CG.",
        "#",
        "# Modules:",
    ]
    for name, origin, size in sources:
        lines.append(f"#   {name:<6} {size:>9,} bytes  {origin}")
    return "\n".join(lines) + "\n\n"


def build(read_module, names, ref):
    """Returns (turtle text, [(name, origin, bytes)])."""
    parts, sources = [], []
    for name, path in module_paths(names):
        result = read_module(name, path)
        if result is None:
            continue
        body, origin = result
        sources.append((name, origin, len(body.encode("utf-8"))))
        parts.append(f"# ---- {name} ({origin}) ----\n{body.rstrip()}\n")

    if not parts:
        sys.exit("no modules were read — nothing to write")

    return header(sources, ref) + "\n".join(parts), sources


def verify(turtle: str):
    """Parse the concatenation and report what the queries depend on.

    Optional, and the only step that needs rdflib, so the build itself has no
    dependencies. The dangling-broader check is the one that matters: a
    skos:broader pointing at a term no included module defines means a module was
    forgotten, and the symptom would be a query silently returning fewer rows.
    """
    try:
        import rdflib
        from rdflib.namespace import OWL, RDF, RDFS, SKOS
    except ImportError:
        print("warning: --verify needs rdflib (pip install rdflib), skipping", file=sys.stderr)
        return

    g = rdflib.Graph()
    g.parse(data=turtle, format="turtle")

    dct_source = rdflib.URIRef("http://purl.org/dc/terms/source")
    counts = {
        "triples": len(g),
        "skos:Concept": sum(1 for _ in g.subjects(RDF.type, SKOS.Concept, unique=True)),
        "dct:source": sum(1 for _ in g.triples((None, dct_source, None))),
        "skos:broader": sum(1 for _ in g.triples((None, SKOS.broader, None))),
        "rdfs:subClassOf": sum(1 for _ in g.triples((None, RDFS.subClassOf, None))),
        "owl:Restriction": sum(1 for _ in g.subjects(RDF.type, OWL.Restriction, unique=True)),
    }
    print("verify   " + " · ".join(f"{k} {v:,}" for k, v in counts.items()))

    # MATERIALIZE_RESTRICTIONS (app/src/query/queryEngine.js) runs on every loaded
    # graph. DPV states its relations directly, so it should have nothing to do here
    # and the Sources chip should report `inferred: 0`.
    if counts["owl:Restriction"]:
        print(
            f"note: {counts['owl:Restriction']} owl:Restriction — the engine will "
            "materialise them and the Sources chip will report inferred > 0",
        )

    defined = set(g.subjects(unique=True))
    dangling = {
        parent
        for parent in g.objects(None, SKOS.broader, unique=True)
        if isinstance(parent, rdflib.URIRef) and parent not in defined
    }
    if dangling:
        print(f"warning: {len(dangling)} skos:broader target(s) are not defined here:", file=sys.stderr)
        for parent in sorted(str(p) for p in dangling)[:10]:
            print(f"  {parent}", file=sys.stderr)
        print("  a hierarchy that leaves this graph cannot be walked — a module is missing.", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source-dir", type=Path, help="a checkout of w3c/dpv, pointed at its 2.3/ directory")
    parser.add_argument("--fetch", action="store_true", help="download the modules instead")
    parser.add_argument("--ref", default="master", help="git ref to fetch (default: master)")
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR, help="where --fetch caches downloads")
    parser.add_argument(
        "--modules",
        default=",".join(name for name, _ in MODULES),
        help="comma-separated subset of: " + ", ".join(name for name, _ in MODULES),
    )
    parser.add_argument("--out", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--no-gzip", action="store_true", help="write plain turtle (the loader sniffs, so both work)")
    parser.add_argument("--verify", action="store_true", help="parse the result and report counts (needs rdflib)")
    parser.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = parser.parse_args()

    if bool(args.source_dir) == bool(args.fetch):
        parser.error("pass exactly one of --source-dir or --fetch")

    if args.fetch:
        if args.ref == "master":
            print(
                "warning: --ref master is a mutable target, so two builds a week apart "
                "can differ while claiming the same provenance. Prefer a tag.",
                file=sys.stderr,
            )
        ref = args.ref
        read_module = lambda name, path: read_fetched(ref, name, path, args.cache_dir)  # noqa: E731
    else:
        ref = f"local checkout {args.source_dir}"
        read_module = lambda name, path: read_local(args.source_dir, name, path)  # noqa: E731

    names = {name.strip() for name in args.modules.split(",") if name.strip()}
    turtle, sources = build(read_module, names, ref)

    for name, origin, size in sources:
        print(f"{name:<6} {size:>9,} bytes  {origin}")
    print(f"{'total':<6} {len(turtle.encode('utf-8')):>9,} bytes")

    if args.verify:
        verify(turtle)

    payload = turtle.encode("utf-8")
    if not args.no_gzip:
        # mtime=0 so the same input gives the same bytes: a timestamp in the gzip
        # header would make every rebuild a new blob in git.
        payload = gzip.compress(payload, compresslevel=9, mtime=0)

    out = args.out
    if args.dry_run:
        print(f"dry run: would write {len(payload):,} bytes to {out}")
        return

    if out.exists() and out.read_bytes() == payload:
        print(f"unchanged: {out} ({len(payload):,} bytes)")
    else:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(payload)
        digest = hashlib.sha256(payload).hexdigest()[:12]
        print(f"Wrote {len(payload):,} bytes to {out} (sha256 {digest})")

    print("NOTE the tripleHint on the `legal` entry in app/src/rdf/knowledgeBases.js")
    print("     must match the triple count --verify reports.")


if __name__ == "__main__":
    main()
