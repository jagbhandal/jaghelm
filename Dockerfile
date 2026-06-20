# ─── Build stage ──────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
WORKDIR /app

# Install all deps (incl. devDeps for the Vite build) reproducibly from lock file.
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend (vite produces dist/)
COPY . .
RUN npm run build

# ─── Runtime stage ────────────────────────────────────────────────────────
FROM node:26-alpine
WORKDIR /app

# Build-time provenance args. The CI build passes these (see
# .github/workflows/build-push.yml); they default to "dev" for local builds so
# `docker build` never fails on an unset arg.
ARG IMAGE_VERSION=dev
ARG IMAGE_SOURCE=https://github.com/jagbhandal/jaghelm
ARG IMAGE_REVISION=unknown

# Bring in built artifacts + server source + lock file (needed for npm ci).
# --chown ensures files belong to the unprivileged `node` user from the start.
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./

# Install production deps only, reproducible from the lock file.
# --ignore-scripts blocks any postinstall lifecycle script from a dependency
# running during the image build (supply-chain hardening; the runtime deps here
# do not require build scripts).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Pre-create mount points so the container has them even when running without
# bind mounts. chown so the unprivileged user can write.
RUN mkdir -p /app/uploads /app/data && chown -R node:node /app/uploads /app/data

# Drop root.
# NOTE: host bind-mount targets must be writable by UID 1000 (the `node` user
# in node:alpine images). One-time host fix:
#   sudo chown -R 1000:1000 /opt/stacks/jaghelm/uploads /opt/stacks/jaghelm/data
USER node

# Container-internal health check. Uses Node's native fetch — no curl in Alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3099/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 3099
CMD ["node", "server/index.js"]

# OCI image metadata — kept last so changing labels never busts earlier layers.
# These let `docker inspect` / registries resolve exactly what source + version
# produced this image, which makes rollback ("redeploy the SHA that worked")
# auditable.
LABEL org.opencontainers.image.title="JagHelm" \
      org.opencontainers.image.description="Self-hosted homelab dashboard with live data" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.licenses="MIT"
