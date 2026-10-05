#!/bin/sh
# Builds vscode/d3sign.vsix in Docker. Needs vscode/package-lock.json:
# run `npm install` once in vscode/ to create it.
set -eu
cd "$(dirname "$0")/.."
DOCKER_BUILDKIT=1 docker build -f vscode/Dockerfile --target artifact \
  --output type=local,dest=vscode .
echo "built vscode/d3sign.vsix"
