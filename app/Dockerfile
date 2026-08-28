# Build the static SPA
FROM docker.io/library/node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build
# node:24-alpine

WORKDIR /app

COPY package.json ./
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install

COPY . .
RUN pnpm run build

# Serve the built assets
FROM docker.io/library/nginx@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913 AS runtime
# nginx:alpine

RUN apk --no-cache upgrade

COPY --from=build /app/dist /usr/share/nginx/html

USER nginx

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD wget -qO- http://localhost/ || exit 1
EXPOSE 80
