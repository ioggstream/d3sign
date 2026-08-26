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
# Offline by default: every input it needs is committed, so a plain run is
# deterministic, needs no network, and is safe in a pre-commit hook or CI. The one step
# that downloads (DPV from w3c/dpv) is opt-in behind --fetch-dpv.
#
# Usage:
#   app/scripts/rebuild-data.sh                     # projections only, offline
#   app/scripts/rebuild-data.sh --fetch-dpv v2.3    # also refetch DPV at that tag
#   app/scripts/rebuild-data.sh --d3fend ~/d3fend.ttl
#
# Requires: rdflib (pip install rdflib)

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$APP_DIR/scripts"
KG="$APP_DIR/public/kg"

# The committed ontology. build-d3fend-{categories,completions,metadata}.py all read
# gzip directly, so nothing has to be decompressed to a temp file first.
D3FEND="$KG/d3fend.ttl.gz"
FETCH_DPV=
DPV_REF=

usage() {
  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
for required in "$D3FEND" "$KG/regulation.ttl"; do
  [ -f "$required" ] ||
    { echo "missing required input: $required" >&2; exit 1; }
done

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
