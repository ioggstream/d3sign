# checkov:skip=CKV_DOCKER_2: build-only image, never run as a container or daemon
# checkov:skip=CKV_DOCKER_3: the scratch artifact stage has no users; the build stage runs as node
# Builds the VS Code extension. The build context is the repository root, because
# the extension bundles ../app/src:
#
#   sh vscode/build.sh
FROM docker.io/library/node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build
# node:24-alpine

# The build runs as the unprivileged `node` user (uid 1000).
USER node
RUN mkdir /home/node/src /home/node/out
WORKDIR /home/node/src

# Dependencies first, so a source change does not reinstall them. The bundler
# resolves the shared sources' imports (n3, cytoscape, yaml…) from app/node_modules.
COPY --chown=node:node app/package.json app/package-lock.json app/
RUN cd app && npm ci
COPY --chown=node:node vscode/package.json vscode/package-lock.json vscode/
RUN cd vscode && npm ci

COPY --chown=node:node app/src app/src
COPY --chown=node:node app/config app/config
COPY --chown=node:node LICENSE vscode/LICENSE
COPY --chown=node:node vscode vscode
RUN cd vscode && npm run build && npm run package && mv d3sign.vsix /home/node/out/

# Only the .vsix leaves the build: `docker build --output` copies this stage.
FROM scratch AS artifact
COPY --from=build /home/node/out/d3sign.vsix /
