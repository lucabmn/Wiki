FROM node:24-slim AS base
RUN npm install -g pnpm@11
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

COPY . .
RUN --mount=type=cache,target=/pnpm-store pnpm install --store-dir /pnpm-store

ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=

EXPOSE 1234

# Run unprivileged: a compromised app process must not own the container.
USER node

# Hocuspocus is built on `ws`/crossws and refuses to run under Bun, so the
# collab service runs on Node. It executes its TypeScript entrypoint directly
# via tsx (a runtime dependency) — no separate bundle step.
WORKDIR /app/apps/collab
CMD ["node", "--import", "tsx", "src/index.ts"]
