# LandingOS — production Docker image for the website-builder product.
#
# BUILD CONTEXT IS THE WORKSPACE ROOT, not this directory. The lockfile lives
# at the root now that this is one workspace among several, so a build run with
# this directory as context has no lockfile to install from. Build it with:
#
#   docker build -f apps/website-builder/Dockerfile -t landingos-builder .
#
# Multi-stage build:
#   1) deps    — install node_modules for THIS workspace only (cached layer)
#   2) builder — prisma generate + next build → standalone output
#   3) runner  — slim runtime: standalone server + static assets + prisma client
#
# Persistence: NOTHING durable lives inside this image. The database is an
# external Postgres (Neon) reached via a runtime DATABASE_URL, and uploaded
# images go to Cloudflare R2. That combination is what lets the app run on a
# host with a purely ephemeral filesystem — such as the Render free tier, which
# wipes the container on every deploy and every idle spin-down.
#
# /app/data still exists as a local fallback for uploads when R2 is not
# configured (useful for self-hosting with a mounted volume), but on Render it
# is scratch space and its contents are expected to disappear.

# ---------- 1) deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

# OpenSSL is required by Prisma's native query engine on Alpine.
RUN apk add --no-cache libc6-compat openssl

# Pin npm rather than trusting whatever the base image bundles. `node:22-alpine`
# is a moving tag, so its npm changes under us — and npm versions disagree about
# optional peer dependencies, which decides whether package-lock.json is
# considered in sync at all.
#
# This is not hypothetical: an npm 11 lockfile omits a nested @swc/helpers copy
# that npm 10 insists on (next pins the hoisted one to 0.5.15 while a transitive
# peer wants >=0.5.17), and npm ci failed the build with
# "Missing: @swc/helpers@0.5.23 from lock file" while installing fine locally.
#
# The pin therefore has to track whichever npm generated the lockfile. Becoming
# a workspace regenerated it at the root under npm 11, so the previous 10.9.4
# pin now names the version that CANNOT read it — the same breakage as before,
# with the two sides swapped.
#
# If you regenerate package-lock.json, use THIS version so the two stay aligned:
#   npx npm@11.16.0 install --package-lock-only
RUN npm i -g npm@11.16.0

# Workspace manifests + the single root lockfile. Every workspace's package.json
# must be present or npm ci refuses to validate the lockfile — even the ones
# this image will not install.
COPY package.json package-lock.json ./
COPY apps/website-builder/package.json ./apps/website-builder/
COPY apps/erp/package.json ./apps/erp/
COPY packages/product-registry/package.json ./packages/product-registry/
COPY apps/website-builder/prisma ./apps/website-builder/prisma

# Only this product's dependencies. Without the --workspace filter npm would
# also install the ERP's better-sqlite3, which compiles a native binding this
# image has no use for and no toolchain to build.
RUN npm ci --workspace @landingos/website-builder --include-workspace-root

# ---------- 2) builder ----------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env. AUTH_SECRET can be overridden at runtime; we set a build-time
# placeholder so the build doesn't hard-fail, but the real secret MUST be
# provided as a runtime env var on the host.
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder only. `prisma generate` and `next build` never open a connection,
# but Prisma validates that the URL scheme matches the datasource provider — so
# this has to be a postgresql:// string, not a file: one. Nothing connects here.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV AUTH_SECRET="build-time-placeholder-change-at-runtime"

# Build this workspace. `prebuild` runs prisma generate, so the client is
# produced by the build rather than by an install side-effect.
RUN npm run build --workspace @landingos/website-builder

# ---------- 3) runner ----------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for security.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Create the persistent data directory, owned by the runtime user. Mount a
# volume here on the host. Without the chown, the container fails at startup
# with "unable to open database file" since it runs as nextjs, not root.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Standalone output mirrors the workspace layout, because outputFileTracingRoot
# points at the workspace root (see next.config.ts). Verified against a real
# build: the server is at standalone/apps/website-builder/server.js and
# node_modules sits hoisted beside it at standalone/node_modules. Copying the
# whole tree to /app preserves both relationships, so the runtime paths below
# are all prefixed with apps/website-builder/ — including the one the
# entrypoint execs.
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/.next/standalone ./
# --- Static assets Next.js does NOT bundle into standalone ---
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/.next/static ./apps/website-builder/.next/static
# --- Public assets (logo, avatars, products) + uploads dir ---
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/public ./apps/website-builder/public
# --- Prisma schema + seed scripts (needed at startup) ---
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/prisma ./apps/website-builder/prisma
# --- Source needed by seed scripts (they import from ../src/lib/db) ---
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/src/lib ./apps/website-builder/src/lib
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/tsconfig.json ./apps/website-builder/tsconfig.json
# --- Full node_modules so tsx + prisma client are available at runtime ---
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs apps/website-builder/package.json ./apps/website-builder/

# DATABASE_URL is deliberately NOT set here. It must come from the host at
# runtime (Render → Environment) pointing at the external Postgres. Baking a
# default in would be worse than having none: a forgotten host variable would
# silently fall back to a throwaway database instead of failing, and the
# entrypoint would happily seed a fresh store over an empty schema. The
# entrypoint refuses to start without it.

# Entrypoint: verify config, push schema, seed admin/themes/wilayas
# (idempotent), seed demo data, then start the server.
COPY --chown=nextjs:nodejs apps/website-builder/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs
EXPOSE 3000

CMD ["/app/docker-entrypoint.sh"]
