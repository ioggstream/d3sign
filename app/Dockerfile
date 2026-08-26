# Build the static SPA
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json ./
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install

COPY . .
RUN pnpm run build

# Serve the built assets
FROM nginx:alpine AS runtime

RUN apk --no-cache upgrade

COPY --from=build /app/dist /usr/share/nginx/html

USER nginx

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD wget -qO- http://localhost/ || exit 1
EXPOSE 80
