#!/usr/bin/env bash
#
# Rebuild every precomputed data file under app/src/data/ from the knowledge bases in
# app/public/kg/.
#
# There are six generators and their invocations all differ — three take a turtle path,
# one takes flags and the network, two take nothing — which is how the README ended up
# with four separate command blocks that had to be transcribed in the right order. This
# is that order, executable.
#
# The D3FEND release is the D3FEND_VERSION variable below, and it drives everything:
# the ontology downloaded into app/public/kg/, all six projections, and the version the
# page header shows (app/config/d3fend.json, generated here — index.html hard-codes no
# number). Upgrading D3FEND is therefore one edit and one run:
#
#   1. bump D3FEND_VERSION;
#   2. app/scripts/rebuild-data.sh --fetch-d3fend;
#   3. commit d3fend.ttl.gz, config/d3fend.json and src/data/.
#
# The order inside matters and is the reason this is a script: the ontology is fetched
# and gated *first*, so every generator that follows reads one release, and a wrong
# version or a renamed prefix stops the run before anything under src/data/ has been
# written.
#
# Offline by default: every input it needs is committed, so a plain run is
# deterministic, needs no network, and is safe in a pre-commit hook or CI. The two steps
# that download (D3FEND from MITRE, DPV from w3c/dpv) are opt-in behind --fetch-d3fend
# and --fetch-dpv — except that a D3FEND_VERSION bump with no matching ontology on disk
# fetches on its own, since the alternative is refusing to do the one thing the bump
# asked for.
#
# Usage:
#   app/scripts/rebuild-data.sh                     # projections only, offline
#   app/scripts/rebuild-data.sh --fetch-d3fend      # refetch D3FEND_VERSION, then rebuild
#   app/scripts/rebuild-data.sh --fetch-dpv v2.3    # also refetch DPV at that tag
#   app/scripts/rebuild-data.sh --d3fend ~/d3fend.ttl
#
# Requires: rdflib (pip install rdflib)

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$APP_DIR/scripts"
KG="$APP_DIR/public/kg"

# ---------------------------------------------------------------------------
# The D3FEND release. The single number this whole build hangs off; see the header.
D3FEND_VERSION="1.6.0"
# `{version}` is substituted. MITRE keeps every release at this path, so the
# download is reproducible — unlike /ontologies/d3fend.ttl, which is whatever is
# current.
D3FEND_URL="https://d3fend.mitre.org/ontologies/d3fend/{version}/d3fend.ttl"
# ---------------------------------------------------------------------------

# The committed ontology. build-d3fend-{categories,completions,metadata}.py all read
# gzip directly, so nothing has to be decompressed to a temp file first.
D3FEND="$KG/d3fend.ttl.gz"
FETCH_D3FEND=
FETCH_DPV=
DPV_REF=

usage() {
  sed -n '3,37p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --fetch-dpv)
      FETCH_DPV=1
      # An optional ref may follow. Anything starting with `-` is the next flag.
      if [ $# -gt 1 ] && [ "${2#-}" = "$2" ]; then
        DPV_REF="$2"
        shift
      fi
      ;;
    --fetch-d3fend)
      FETCH_D3FEND=1
      ;;
    --d3fend)
      [ $# -gt 1 ] || { echo "--d3fend needs a path" >&2; exit 2; }
      D3FEND="$2"
      shift
      ;;
    -h | --help) usage 0 ;;
    *)
      echo "unknown argument: $1" >&2
      usage 2
      ;;
  esac
  shift
done

step() { printf '\n=== %s\n' "$1"; }

# One clear message instead of five separate tracebacks.
python3 -c 'import rdflib' 2>/dev/null ||
  { echo "rdflib is required: pip install rdflib" >&2; exit 1; }

# Refuse rather than silently skip: a missing input means a wrong output file, and
# a rebuild that quietly produced a smaller projection would be worse than no rebuild.
# The ontology is not in this list: it is the one input this script can produce
# itself, and the release step below either fetches it or says why it cannot.
for required in "$KG/regulation.ttl"; do
  [ -f "$required" ] ||
    { echo "missing required input: $required" >&2; exit 1; }
done

# Every D3FEND-release job — download, gate, config — is the same script and the
# same two variables.
d3fend_kg() {
  python3 "$SCRIPTS/build-d3fend-kg.py" \
    --version "$D3FEND_VERSION" --url "$D3FEND_URL" "$@"
}

# A bump to D3FEND_VERSION with the old ontology still on disk means the download
# nobody asked for explicitly but everybody meant. Only for the committed path: with
# --d3fend the user chose the file, so a mismatch is theirs to resolve.
if [ -z "$FETCH_D3FEND" ] && [ "$D3FEND" = "$KG/d3fend.ttl.gz" ] &&
  ! d3fend_kg --verify --ttl "$D3FEND" >/dev/null 2>&1; then
  echo "$(basename "$D3FEND") is not D3FEND $D3FEND_VERSION — fetching it" >&2
  FETCH_D3FEND=1
fi

if [ -n "$FETCH_D3FEND" ]; then
  if [ "$D3FEND" != "$KG/d3fend.ttl.gz" ]; then
    echo "--fetch-d3fend downloads to $KG/d3fend.ttl.gz; drop --d3fend" >&2
    exit 2
  fi
  step "D3FEND ontology      <- $D3FEND_VERSION from d3fend.mitre.org"
  d3fend_kg --fetch
fi

# The gate. Before it, no generator has run, so a wrong version or a D3FEND namespace
# bound to something other than `d3f:` costs a message rather than a src/data/ built
# from one release and a header claiming another.
step "D3FEND release gate  <- D3FEND_VERSION=$D3FEND_VERSION"
d3fend_kg --verify --ttl "$D3FEND"

step "D3FEND version       -> config/d3fend.json"
d3fend_kg --write-config --ttl "$D3FEND"

if [ -n "$FETCH_DPV" ]; then
  step "DPV knowledge base (downloading${DPV_REF:+, ref $DPV_REF})"
  if [ -z "$DPV_REF" ]; then
    # ADR 0025 asks for this warning: `master` is mutable, so two builds a week apart
    # can differ while claiming the same provenance in the file header.
    echo "warning: no ref given, using the mutable default — prefer a tag" >&2
  fi
  python3 "$SCRIPTS/build-legal-kg.py" --fetch ${DPV_REF:+--ref "$DPV_REF"} --verify
elif [ ! -f "$KG/legal.ttl.gz" ]; then
  echo "missing $KG/legal.ttl.gz — rerun with --fetch-dpv <tag>" >&2
  exit 1
fi

step "D3FEND completions   <- $(basename "$D3FEND")"
python3 "$SCRIPTS/build-d3fend-completions.py" "$D3FEND"

step "D3FEND categories    <- $(basename "$D3FEND")"
python3 "$SCRIPTS/build-d3fend-categories.py" "$D3FEND"

step "D3FEND metadata      <- $(basename "$D3FEND")"
python3 "$SCRIPTS/build-d3fend-metadata.py" "$D3FEND"

# After build-legal-kg.py, which writes the legal.ttl.gz this reads.
step "legal terms + families <- legal.ttl.gz, regulation.ttl"
python3 "$SCRIPTS/build-legal-metadata.py"

step "D3FEND alignment     <- regulation.ttl"
python3 "$SCRIPTS/build-alignment-metadata.py"

printf '\nDone. Every generator is idempotent, so `git diff` should be empty on a\n'
printf 'second run with the same inputs.\n'
