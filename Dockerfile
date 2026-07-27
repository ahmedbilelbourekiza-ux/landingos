# LandingOS — production Docker image.
#
# Multi-stage build:
#   1) deps    — install node_modules (cached layer)
#   2) builder — prisma generate + next build → standalone output
#   3) runner  — slim runtime: standalone server + static assets + prisma client
#
# Persistence: the app uses SQLite (db/custom.db) and local image uploads
# (public/uploads). Both live under /app/data, which Railway/Render mount as a
# persistent volume so data survives redeploys. DATABASE_URL points there.

# ---------- 1) deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

# OpenSSL is required by Prisma's native query engine on Alpine.
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

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
ENV DATABASE_URL="file:/tmp/build.db"
ENV AUTH_SECRET="build-time-placeholder-change-at-runtime"

# Generate the Prisma client, then build the standalone Next.js bundle.
RUN npx prisma generate
RUN npm run build

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

# --- Standalone server bundle ---
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# --- Static assets Next.js does NOT bundle into standalone ---
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# --- Public assets (logo, avatars, products) + uploads dir ---
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# --- Prisma schema + seed scripts (needed at startup) ---
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# --- Source needed by seed scripts (they import from ../src/lib/db) ---
COPY --from=builder --chown=nextjs:nodejs /app/src/lib ./src/lib
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
# --- Full node_modules so tsx + prisma client are available at runtime ---
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json ./

# Persist SQLite DB + uploads across redeploys. /app/data is the volume mount.
ENV DATABASE_URL="file:/app/data/custom.db"

# Entrypoint: push schema, seed admin/themes/wilayas (idempotent), seed demo
# data, then start the server. The DB file lives on the persistent volume.
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs
EXPOSE 3000

CMD ["/app/docker-entrypoint.sh"]
