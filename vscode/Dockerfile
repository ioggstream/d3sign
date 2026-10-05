# Builds the VS Code extension. The build context is the repository root, because
# the extension bundles ../app/src:
#
#   sh vscode/build.sh
FROM docker.io/library/node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build
# node:24-alpine

WORKDIR /src

# Dependencies first, so a source change does not reinstall them. The bundler
# resolves the shared sources' imports (n3, cytoscape, yaml…) from app/node_modules.
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci
COPY vscode/package.json vscode/package-lock.json vscode/
RUN cd vscode && npm ci

COPY app/src app/src
COPY app/config app/config
COPY LICENSE vscode/LICENSE
COPY vscode vscode
RUN cd vscode && npm run build && mkdir /out && npm run package && mv d3sign.vsix /out/

# Only the .vsix leaves the build: `docker build --output` copies this stage.
FROM scratch AS artifact
COPY --from=build /out/d3sign.vsix /
