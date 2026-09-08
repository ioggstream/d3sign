#!/usr/bin/env python3
"""Fetch, normalize and verify app/public/kg/d3fend.ttl.gz for one D3FEND release.

The release number is a variable in app/scripts/rebuild-data.sh and is passed in
with --version; nothing here guesses it. That script downloads the release, checks
it, writes app/config/d3fend.json for the page header, and only then runs the
generators, so the ontology in app/public/kg/, every projection under
app/src/data/ and the version shown in the header cannot disagree.

Three jobs, one per flag:

  --fetch    download the release and store it gzipped, normalizing the D3FEND
             namespace to the `d3f:` prefix (see normalize_prefix).
  --verify   fail unless the stored ontology declares the requested
             owl:versionInfo and binds `d3f:` to the D3FEND namespace. This is
             the gate: it runs before any generator, so a mismatch costs a
             message rather than a half-rebuilt src/data/.
  --write-config  project the ontology's own stanza into app/config/d3fend.json,
             which app/src/main.js imports to label the header.

Usage:
    python3 app/scripts/build-d3fend-kg.py --version 1.4.0 --verify
    python3 app/scripts/build-d3fend-kg.py --version 1.4.0 \\
        --url 'https://d3fend.mitre.org/ontologies/d3fend/{version}/d3fend.ttl' --fetch

Requires: rdflib only for the normalizing pass, which runs only when the
download uses a prefix other than `d3f:`. Everything else is stdlib.
"""
import argparse
import gzip
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
OUTPUT_PATH = APP_DIR / "public" / "kg" / "d3fend.ttl.gz"
CONFIG_PATH = APP_DIR / "config" / "d3fend.json"

ONTOLOGY_IRI = "http://d3fend.mitre.org/ontologies/d3fend.owl"
D3FEND_NS = f"{ONTOLOGY_IRI}#"
# Not negotiable: the diagram syntax, every generated projection and the SPARQL
# preamble in app/src/query/queryPrefixes.js all write D3FEND terms as `d3f:Term`.
D3FEND_PREFIX = "d3f"

# Where the header's version chip points. Not derived from the release: MITRE
# publishes one ontology page, not one per version.
HOMEPAGE = "https://d3fend.mitre.org/resources/ontology/"

# The line that opens the ontology's own stanza. Its position is not a contract:
# D3FEND 1.4.0 put it right after the @prefix block, 1.6.0 sorts it in among the
# terms, ~22k lines down — which is why the whole document is scanned for it.
ONTOLOGY_SUBJECT = f"<{ONTOLOGY_IRI}>"


def open_ttl(path):
    """Text handle on a .ttl or .ttl.gz."""
    opener = gzip.open if str(path).endswith(".gz") else open
    return opener(path, "rt", encoding="utf-8")


def read_facts(lines):
    """(prefix block, ontology stanza) from a turtle line iterator.

    Read as text rather than parsed: rdflib needs ~20 s to reach two literals
    through 130k triples. Returning the stanza on its own is what makes the text
    match safe — `owl:versionInfo` also appears elsewhere in the document, as the
    subject of an annotation-property declaration.
    """
    prefixes = []
    stanza = []
    for line in lines:
        if not stanza:
            if line.startswith("@prefix"):
                prefixes.append(line)
            if not line.startswith(ONTOLOGY_SUBJECT):
                continue
        stanza.append(line)
        # The stanza ends at the ` .` closing it. D3FEND's definitions are full of
        # sentences, so a period only counts outside an open triple-quoted literal.
        if re.search(r"(?:^|\s)\.\s*$", line) and "".join(stanza).count('"""') % 2 == 0:
            break
    return "".join(prefixes), "".join(stanza)


def read_facts_from(path):
    with open_ttl(path) as handle:
        return read_facts(handle)


def prefix_for_d3fend(prefixes):
    """The prefix label the document binds to the D3FEND namespace, or None."""
    found = re.search(rf"@prefix\s+([A-Za-z][\w.-]*):\s*<{re.escape(D3FEND_NS)}>", prefixes)
    return found.group(1) if found else None


def version_in(stanza):
    """owl:versionInfo of the ontology stanza."""
    if "owl:Ontology" not in stanza:
        return None
    found = re.search(r'owl:versionInfo\s+"([^"]+)"', stanza)
    return found.group(1) if found else None


def release_date_in(stanza):
    # Any prefix, not just `d3f:`: the release date is read before the normalizing
    # pass has necessarily run.
    found = re.search(r'[\w.-]*:release-date\s+"([^"T]+)', stanza)
    return found.group(1) if found else None


def normalize_prefix(turtle, found_prefix):
    """Rebind the D3FEND namespace to `d3f:`.

    Done by reparsing and reserializing rather than by rewriting the CURIE tokens:
    a textual pass cannot tell `ex:Term` in a triple from the same string inside
    one of the several thousand definition literals, and D3FEND's definitions
    quote CURIEs. Costs a minute on 130k triples, and runs only when MITRE
    changes the prefix — never on the release this app ships with.
    """
    try:
        import rdflib
    except ImportError:
        sys.exit(
            f"the download binds the D3FEND namespace to `{found_prefix}:`, not `d3f:`, "
            "and normalizing it needs rdflib: pip install rdflib"
        )
    print(f"rebinding `{found_prefix}:` to `{D3FEND_PREFIX}:` (reparsing, this is slow)")
    graph = rdflib.Graph()
    graph.parse(data=turtle, format="turtle")
    graph.namespace_manager.bind(
        D3FEND_PREFIX, rdflib.Namespace(D3FEND_NS), override=True, replace=True
    )
    return graph.serialize(format="turtle")


def fetch(version, url_template, output):
    url = url_template.format(version=version)
    print(f"downloading {url}")
    try:
        with urllib.request.urlopen(url, timeout=300) as response:
            turtle = response.read().decode("utf-8")
    except urllib.error.URLError as error:
        sys.exit(f"cannot download {url}: {error}")

    prefixes, stanza = read_facts(turtle.splitlines(keepends=True))
    found_version = version_in(stanza)
    if found_version != version:
        sys.exit(
            f"{url} declares owl:versionInfo {found_version!r}, not {version!r}. "
            "Fix D3FEND_VERSION or D3FEND_URL in rebuild-data.sh."
        )
    found_prefix = prefix_for_d3fend(prefixes)
    if found_prefix != D3FEND_PREFIX:
        turtle = normalize_prefix(turtle, found_prefix)

    # mtime=0 so two downloads of the same release produce identical bytes and a
    # rebuild does not add a blob to git history for nothing. Only the compressed
    # form is committed — the turtle is ~30 MB (app/src/rdf/knowledgeBases.js).
    with gzip.GzipFile(output, mode="wb", compresslevel=9, mtime=0) as out:
        out.write(turtle.encode("utf-8"))
    print(f"wrote {output} ({output.stat().st_size / 1e6:.1f} MB gzipped)")


def verify(version, path):
    if not path.is_file():
        sys.exit(f"missing {path} — rerun with --fetch-d3fend")
    prefixes, stanza = read_facts_from(path)

    found_version = version_in(stanza)
    if found_version is None:
        sys.exit(f"{path}: no <{ONTOLOGY_IRI}> a owl:Ontology with an owl:versionInfo")
    if found_version != version:
        sys.exit(
            f"{path} is D3FEND {found_version}, but rebuild-data.sh asks for {version}. "
            "Rerun with --fetch-d3fend to download the configured release."
        )

    found_prefix = prefix_for_d3fend(prefixes)
    if found_prefix != D3FEND_PREFIX:
        sys.exit(
            f"{path} binds the D3FEND namespace to `{found_prefix}:`, not `{D3FEND_PREFIX}:`. "
            "Rerun with --fetch-d3fend, which normalizes it."
        )
    print(f"{path.name} is D3FEND {found_version}, `{D3FEND_PREFIX}:` bound, as configured")


def write_config(version, path):
    """app/config/d3fend.json — generated, read by app/src/main.js."""
    _prefixes, stanza = read_facts_from(path)
    record = {
        "_generated": "app/scripts/rebuild-data.sh — do not edit; bump D3FEND_VERSION there",
        "homepage": HOMEPAGE,
        "ontologyIRI": ONTOLOGY_IRI,
        "releaseDate": release_date_in(stanza),
        "version": version,
    }
    # Sorted keys and a trailing newline: the file is committed, so a rebuild
    # against the same release has to leave `git diff` empty.
    CONFIG_PATH.write_text(
        json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {CONFIG_PATH} — D3FEND {version}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="the D3FEND release to work with")
    parser.add_argument(
        "--url",
        default="https://d3fend.mitre.org/ontologies/d3fend/{version}/d3fend.ttl",
        help="download template; {version} is substituted",
    )
    parser.add_argument("--fetch", action="store_true", help="download that release")
    parser.add_argument("--verify", action="store_true", help="gate: check version and prefix")
    parser.add_argument(
        "--write-config", action="store_true", help="write app/config/d3fend.json"
    )
    parser.add_argument("--ttl", type=Path, default=OUTPUT_PATH, help="ontology to read")
    args = parser.parse_args()

    if not (args.fetch or args.verify or args.write_config):
        parser.error("nothing to do: pass --fetch, --verify or --write-config")
    if args.fetch and args.ttl != OUTPUT_PATH:
        parser.error(f"--fetch always writes {OUTPUT_PATH}; drop --ttl")

    if args.fetch:
        fetch(args.version, args.url, OUTPUT_PATH)
    if args.verify:
        verify(args.version, args.ttl)
    if args.write_config:
        write_config(args.version, args.ttl)


if __name__ == "__main__":
    main()
