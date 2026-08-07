# LandingOS — production Docker image for the platform.
#
# ONE image serves the whole platform: the builder console + API, the ERP
# console + API, the platform surfaces (auth, team, billing, integrations) and
# the public storefront. They are route groups in one Next.js app; which
# products a tenant sees is an entitlements question, not a build question.
# The retired legacy app (apps/erp) ships its package.json only — npm needs it
# to validate the lockfile — and none of its code or dependencies.
#
# BUILD CONTEXT IS THE WORKSPACE ROOT, not this directory. The lockfile lives
# at the root, so a build run with this directory as context has no lockfile
# to install from. Build it with:
#
#   docker build -f apps/website-builder/Dockerfile -t landingos .
#
# Multi-stage build:
#   1) deps    — install node_modules for THIS workspace only (cached layer)
#   2) builder — generate BOTH Prisma clients + next build → standalone output
#   3) runner  — slim runtime: standalone server + static assets + the pieces
#                the entrypoint's database checks need
#
# Persistence: NOTHING durable lives inside this image. The database is an
# external Postgres (Neon) reached via a runtime PLATFORM_DATABASE_URL, and
# uploaded images go to Cloudflare R2. /app/data exists as a local upload
# fallback for self-hosting with a mounted volume; on an ephemeral host it is
# scratch space.
#
# THE IMAGE NEVER RUNS DDL. The runtime credential is landingos_app —
# NOBYPASSRLS, owner of nothing — which is precisely what makes row-level
# security real, and equally what makes `prisma db push` impossible from this
# container. Schema pushes, role setup, RLS application and reference seeding
# are deliberate migration steps run from the repository (see DEPLOY.md); the
# entrypoint VERIFIES the schema is present and refuses to start otherwise.

# ---------- 1) deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

# OpenSSL is required by Prisma's native engines on Alpine.
RUN apk add --no-cache libc6-compat openssl

# Pin npm rather than trusting whatever the base image bundles. npm versions
# disagree about optional peer dependencies, which decides whether
# package-lock.json is considered in sync at all. The pin must track whichever
# npm generated the lockfile — currently npm 11. If you regenerate the
# lockfile, use THIS version so the two stay aligned:
#   npx npm@11.16.0 install --package-lock-only
RUN npm i -g npm@11.16.0

# The root lockfile plus EVERY workspace manifest. npm ci validates the
# lockfile against the whole workspace tree, so a missing manifest — even for
# a workspace this image never installs — fails the install. This list must
# grow with the workspace; the build failing at this step after adding a
# package is this comment telling you to add its manifest here.
COPY package.json package-lock.json ./
COPY apps/website-builder/package.json ./apps/website-builder/
COPY apps/erp/package.json ./apps/erp/
COPY packages/auth/package.json ./packages/auth/
COPY packages/db/package.json ./packages/db/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/product-registry/package.json ./packages/product-registry/
COPY packages/ui/package.json ./packages/ui/
COPY services/worker/package.json ./services/worker/

# Only this product's dependency graph (which includes the @landingos/*
# workspace packages it links). Without the --workspace filter npm would also
# install the legacy ERP's better-sqlite3, which compiles a native binding
# this image has no use for and no toolchain to build.
RUN npm ci --workspace @landingos/website-builder --include-workspace-root

# ---------- 2) builder ----------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Placeholders only. Neither `prisma generate` nor `next build` opens a
# connection (every page is force-dynamic), but Prisma validates that the URL
# scheme matches the datasource provider, so these must be postgresql://
# strings. The real values MUST come from the host at runtime.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV PLATFORM_DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV AUTH_SECRET="build-time-placeholder-change-at-runtime"

# The PLATFORM client — the one every live route queries through
# (@landingos/db → packages/db/prisma/client). Generated IN the image so the
# native query engine matches this image's platform (linux-musl), never a dev
# machine's. The app's own prebuild generates the second, app-local client
# (src/generated/prisma), which survives only as a source of TypeScript types
# for the editor components.
RUN npx prisma generate --schema packages/db/prisma/schema

# Build this workspace. `prebuild` runs the app-local prisma generate.
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

# Local-disk upload fallback, owned by the runtime user. Mount a volume here
# when self-hosting without R2.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Standalone output mirrors the workspace layout, because outputFileTracingRoot
# points at the workspace root (see next.config.ts): the server is at
# standalone/apps/website-builder/server.js with traced node_modules hoisted
# beside it. Copying the whole tree to /app preserves both relationships.
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/.next/standalone ./
# --- Static assets Next.js does NOT bundle into standalone ---
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/.next/static ./apps/website-builder/.next/static
# --- Public assets (logo, sample images) ---
COPY --from=builder --chown=nextjs:nodejs /app/apps/website-builder/public ./apps/website-builder/public
# --- The platform schema, for the entrypoint's connectivity/schema probe. ---
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/prisma/schema ./packages/db/prisma/schema
# --- The generated platform client WITH its query engine, at the path the
#     BUNDLED code searches. The standalone bundle rewrites the client's
#     __dirname relative to the APP directory, so at runtime it looks in
#     apps/website-builder/packages/db/prisma/client — NOT the workspace-root
#     packages/ path the source tree uses. Verified against the real error:
#     "could not locate the Query Engine ... searched:
#      /app/apps/website-builder/packages/db/prisma/client". ---
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/prisma/client ./apps/website-builder/packages/db/prisma/client
# --- Full node_modules, replacing the traced subset: the entrypoint needs the
#     prisma CLI and its schema engine for the boot-time checks. ---
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# No DATABASE_URL / PLATFORM_DATABASE_URL here, deliberately. They must come
# from the host at runtime; a baked-in default would let a forgotten host
# variable fall back silently instead of failing loudly at startup.

COPY --chown=nextjs:nodejs apps/website-builder/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs
EXPOSE 3000

CMD ["/app/docker-entrypoint.sh"]
