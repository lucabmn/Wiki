FROM node:24-slim AS base
RUN npm install -g pnpm@11
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

COPY . .
RUN --mount=type=cache,target=/pnpm-store pnpm install --store-dir /pnpm-store

ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ARG VITE_COLLAB_URL
ENV VITE_COLLAB_URL=${VITE_COLLAB_URL}
ENV NODE_ENV=production
RUN cd apps/web && pnpm run build
ENV SKIP_ENV_VALIDATION=

ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# Run unprivileged: a compromised app process must not own the container.
USER node

# SSR chunks require() externals at runtime; must run from the workspace
WORKDIR /app/apps/web
CMD ["node", ".output/server/index.mjs"]
