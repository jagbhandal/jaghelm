# ─── Base images ──────────────────────────────────────────────────────────
# Both pinned by digest for reproducible builds (the cosign-signed pipeline
# otherwise rests on mutable tags). Bump the digests by hand, together — there
# is no automated updater (GitHub is a push mirror that prunes bot branches).
#
# The Node image builds the app. The runtime is plain Alpine plus the Node
# binary copied out of the Node image, so npm, npx, yarn and corepack never
# reach it (nothing at runtime uses them: the healthcheck and CMD call `node`).
# The Alpine pin must be the Alpine release the Node image is built on, because
# its Node binary links against that release's libstdc++; the runtime stage
# refuses to build when the two differ.
# Tags for readability: node:22-alpine, alpine:3.24.1
FROM node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS node-base

# ─── Build stage ──────────────────────────────────────────────────────────
FROM node-base AS builder
WORKDIR /app

# Install all deps (incl. devDeps for the Vite build) reproducibly from lock file.
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend (vite produces dist/)
COPY . .
RUN npm run build

# ─── Production dependencies ──────────────────────────────────────────────
FROM node-base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production deps only, reproducible from the lock file. --ignore-scripts blocks
# any postinstall lifecycle script from a dependency running during the image
# build (supply-chain hardening; the runtime deps here do not require build
# scripts).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ─── Node binary ──────────────────────────────────────────────────────────
# The binary and Node's LICENSE (its MIT licence and the notices of what it
# bundles: OpenSSL, ICU, V8 and more; the image is public, so they ship with
# it), in directories stamped with the binary's own mtime. Copying single files
# would stamp /usr/local/bin with the build time, making the 127 MB layer
# different in every build; copying this tree keeps the layer byte-identical for
# a given pair of digests and builder, so image versions share it on the host
# and in the registry, as they shared the Node image's layers.
FROM node-base AS node-bin
RUN mkdir -p /node/bin \
    && cp -p /usr/local/bin/node /node/bin/node \
    && cp -p /usr/local/LICENSE /node/LICENSE \
    && touch -r /usr/local/bin/node /node/bin /node

# ─── Runtime stage ────────────────────────────────────────────────────────
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

# The Node binary and its LICENSE first, straight onto the Alpine layer (see
# above): /usr/local/bin/node and /usr/local/LICENSE, as in the Node image.
COPY --from=node-bin /node/ /usr/local/

# One layer for the system setup:
#   - refuse an Alpine release other than the Node image's (see the top);
#   - the unprivileged `node` user, UID/GID 1000 as in the Node image;
#   - libstdc++ (and libgcc), the Node binary's only libraries beyond musl;
#   - smoke-test the binary, and fail the build if a package manager is on PATH;
#   - pre-create the mount points so the container has them even when running
#     without bind mounts, writable by the unprivileged user.
RUN --mount=type=bind,from=node-base,source=/etc/alpine-release,target=/tmp/node-alpine-release \
    set -eu; \
    runtime="$(cut -d. -f1,2 /etc/alpine-release)"; \
    node_image="$(cut -d. -f1,2 /tmp/node-alpine-release)"; \
    if [ "$runtime" != "$node_image" ]; then \
      echo "runtime is Alpine $runtime but the Node image is built on Alpine $node_image: bump the alpine pin" >&2; \
      exit 1; \
    fi; \
    addgroup -g 1000 node; \
    adduser -u 1000 -G node -s /bin/sh -D node; \
    apk add --no-cache libstdc++; \
    node --version; \
    for tool in npm npx yarn yarnpkg corepack; do \
      if command -v "$tool" >/dev/null; then echo "$tool must not be in the runtime image" >&2; exit 1; fi; \
    done; \
    mkdir -p /app/uploads /app/data; \
    chown -R node:node /app/uploads /app/data

WORKDIR /app

# Production deps, then built artifacts + server source. The package.json is
# needed at runtime ("type": "module", and server/version.js reads the version).
# --chown gives the app files to the unprivileged `node` user; node_modules
# stays root-owned, as before.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/dist ./dist

# Drop root.
# NOTE: host bind-mount targets must be writable by UID 1000 (the `node` user).
# One-time host fix:
#   sudo chown -R 1000:1000 /opt/stacks/jaghelm/uploads /opt/stacks/jaghelm/data
USER node

# Container-internal health check. Uses Node's native fetch — no curl in Alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3099/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 3099
CMD ["node", "server/index.js"]

# Build-time provenance args. The CI build passes these (see
# .github/workflows/build-push.yml); they default to "dev" for local builds so
# `docker build` never fails on an unset arg. Declared here, after every RUN,
# so a new commit SHA doesn't invalidate the cached layers above.
ARG IMAGE_VERSION=dev
ARG IMAGE_SOURCE=https://github.com/jagbhandal/jaghelm
ARG IMAGE_REVISION=unknown

# OCI image metadata — kept last so changing labels never busts earlier layers.
# These let `docker inspect` / registries resolve exactly what source + version
# produced this image, which makes rollback ("redeploy the SHA that worked")
# auditable.
# Expose the build commit to the app at runtime (reported by /api/health).
ENV JAGHELM_REVISION=${IMAGE_REVISION}

LABEL org.opencontainers.image.title="JagHelm" \
      org.opencontainers.image.description="Self-hosted homelab dashboard with live data" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.licenses="MIT"
