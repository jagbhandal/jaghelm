# ─── Base images ──────────────────────────────────────────────────────────
# Both pinned by digest for reproducible builds (the cosign-signed pipeline
# otherwise rests on mutable tags). Bump the digests by hand, together — there
# is no automated updater (GitHub is a push mirror that prunes bot branches).
#
# The Node image builds the app. The runtime is plain Alpine plus the Node
# binary copied out of the Node image, so npm, npx, yarn and corepack never
# reach it (nothing at runtime uses them: the healthcheck and CMD call `node`).
# The Alpine pin must be the Alpine release the Node image is built on, because
# its Node binary links against that release's libstdc++ and libatomic; the
# runtime stage refuses to build when the two differ.
# Tags for readability: node:26-alpine (built on alpine:3.24.3), alpine:3.24.3
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS node-base

# ─── Build stage ──────────────────────────────────────────────────────────
FROM node-base AS builder
WORKDIR /app

# Install all deps (incl. devDeps for the Vite build) reproducibly from lock file.
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend (vite produces dist/)
COPY . .
RUN npm run build
# Pin the mtime of everything the runtime stage copies from here (#358). COPY
# keeps source mtimes: the checkout time of package.json and server/, and the
# build time of dist/, so these layers differed in every build even when the
# bytes did not. Content-identical inputs now give identical layer digests.
# package.json and server/ get mtime 0. dist/ is served to browsers, and
# express.static derives its weak ETag from size + mtime: mtime 0 would make a
# rebuild that only renames Vite's asset hashes (same-size index.html) answer
# 304 and leave browsers on a shell whose assets 404. So each dist file gets a
# non-zero mtime derived from its own content (1e9 + first 28 bits of its
# sha256): stable for identical bytes, different when the bytes change.
RUN mkdir -p /stage/pkg/app /stage/server/app /stage/dist/app \
    && cp -a package.json /stage/pkg/app/ \
    && cp -a server /stage/server/app/ \
    && cp -a dist /stage/dist/app/ \
    && chown -R 1000:1000 /stage/pkg/app/package.json /stage/server/app/server /stage/dist/app/dist \
    && find /stage/pkg /stage/server -exec touch -h -d @0 {} + \
    && find /stage/dist -type f | while read -r f; do \
         touch -h -d "@$((1000000000 + 0x$(sha256sum "$f" | cut -c1-7)))" "$f"; \
       done \
    && find /stage/dist -type d -exec touch -h -d @1000000000 {} +

# ─── Production dependencies ──────────────────────────────────────────────
FROM node-base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production deps only, reproducible from the lock file. --ignore-scripts blocks
# any postinstall lifecycle script from a dependency running during the image
# build (supply-chain hardening; the runtime deps here do not require build
# scripts).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Pin node_modules mtimes (npm stamps install time), so the 15 MB layer is
# byte-identical across builds with the same package-lock.json (#358).
RUN mkdir -p /stage/app && mv node_modules /stage/app/ \
    && find /stage -exec touch -h -d @0 {} +

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
FROM alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

# The Node binary and its LICENSE first, straight onto the Alpine layer (see
# above): /usr/local/bin/node and /usr/local/LICENSE, as in the Node image.
COPY --from=node-bin /node/ /usr/local/

# One layer for the system setup:
#   - refuse an Alpine release other than the Node image's (see the top);
#   - the unprivileged `node` user, UID/GID 1000 as in the Node image;
#   - a fixed last-changed day for node in /etc/shadow (adduser writes today's);
#   - libstdc++ (and libgcc) and libatomic, the Node binary's only libraries
#     beyond musl (`ldd /usr/local/bin/node` in the Node image; Node 26 added
#     libatomic);
#   - smoke-test the binary, and fail the build if a package manager is on PATH;
#   - pre-create the mount points so the container has them even when running
#     without bind mounts, writable by the unprivileged user;
#   - pin the mtime of every file this layer touched (apk's database, passwd,
#     the new directories), so the layer is byte-identical across builds (#358).
RUN --mount=type=bind,from=node-base,source=/etc/alpine-release,target=/tmp/node-alpine-release \
    set -eu; \
    touch /tmp/.layer-start; sleep 1; \
    runtime="$(cut -d. -f1,2 /etc/alpine-release)"; \
    node_image="$(cut -d. -f1,2 /tmp/node-alpine-release)"; \
    if [ "$runtime" != "$node_image" ]; then \
      echo "runtime is Alpine $runtime but the Node image is built on Alpine $node_image: bump the alpine pin" >&2; \
      exit 1; \
    fi; \
    addgroup -g 1000 node; \
    adduser -u 1000 -G node -s /bin/sh -D node; \
    sed -i '/^node:/s/^\(node:[^:]*:\)[0-9]*:/\120000:/' /etc/shadow; \
    apk add --no-cache --no-logfile libstdc++ libatomic; \
    node --version; \
    for tool in npm npx yarn yarnpkg corepack; do \
      if command -v "$tool" >/dev/null; then echo "$tool must not be in the runtime image" >&2; exit 1; fi; \
    done; \
    mkdir -p /app/uploads /app/data; \
    chown -R node:node /app/uploads /app/data; \
    find / -xdev -newer /tmp/.layer-start -exec touch -h -d @0 {} + ; \
    rm /tmp/.layer-start; touch -d @0 /tmp

WORKDIR /app

# Production deps, then built artifacts + server source. The package.json is
# needed at runtime ("type": "module", and server/version.js reads the version).
# The builder stage chowns the app files to the unprivileged `node` user (UID
# 1000); node_modules stays root-owned, as before. The trees under /stage are
# rooted at /app with pinned mtimes, and --link builds each layer on its own, so
# the /app directory entry in a layer is not stamped with the build time (a plain
# COPY into /app was, which changed every layer's digest; #358).
COPY --link --from=deps /stage/ /
COPY --link --from=builder /stage/pkg/ /
COPY --link --from=builder /stage/server/ /
COPY --link --from=builder /stage/dist/ /

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
