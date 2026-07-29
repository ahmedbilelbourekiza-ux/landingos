#!/bin/sh
# Container startup script.
#
# Runs on every container start (including redeploys). Steps:
#   1. Verify required config (AUTH_SECRET, DATABASE_URL) and report the
#      upload backend. Refuses to start on a misconfiguration.
#   2. Push the Prisma schema to Postgres (creates tables if missing, leaves
#      existing data intact). Idempotent.
#   3. Seed core data (admin account, themes, wilayas) — upserts, safe to rerun.
#   4. Seed demo content (categories, landings, orders) — skips anything that
#      already exists. Set SKIP_DEMO_SEED=1 on a store with real products.
#   5. Start the Next.js standalone server.
#
# Durable state lives OUTSIDE the container: the database is an external
# Postgres (DATABASE_URL) and images go to Cloudflare R2. On a host with an
# ephemeral filesystem (e.g. Render free tier) nothing under /app survives a
# restart, which is exactly why neither of those is stored locally.

set -e

DATA_DIR="/app/data"
# Local-disk fallback for uploads, used only when R2 is not configured. Next.js
# only serves public/ files that existed at build time, so runtime uploads
# written there would be saved but never served — hence a separate directory
# served by the /api/uploads route instead.
UPLOADS_DIR="/app/data/uploads"

echo "=== LandingOS container starting ==="

# 1. Ensure dirs exist (scratch space, or a mounted volume when self-hosting).
mkdir -p "$DATA_DIR" "$UPLOADS_DIR"
export UPLOADS_DIR
echo "  ✓ data dir: $DATA_DIR"
echo "  ✓ uploads dir: $UPLOADS_DIR"

# Fail fast if AUTH_SECRET is not set — the app cannot sign sessions without it,
# and it is also the key that decrypts stored Meta CAPI tokens.
if [ -z "$AUTH_SECRET" ]; then
  echo "  ✗ FATAL: AUTH_SECRET environment variable is not set."
  echo "    Set it on your hosting provider (Render → Environment)."
  echo "    Generate one with:  openssl rand -base64 32"
  exit 1
fi
echo "  ✓ AUTH_SECRET is set"

# Fail fast on a missing or non-Postgres DATABASE_URL. The Dockerfile
# deliberately ships no default, because a silent fallback here is the worst
# outcome available: the container would come up healthy, seed demo content
# into the wrong database, and take real orders that are never persisted where
# the admin is looking. Refusing to boot makes the misconfiguration obvious.
if [ -z "$DATABASE_URL" ]; then
  echo "  ✗ FATAL: DATABASE_URL environment variable is not set."
  echo "    This app requires an external Postgres database (e.g. Neon)."
  echo "    Set DATABASE_URL on your host to the connection string, e.g."
  echo "    postgresql://user:pass@host.neon.tech/dbname?sslmode=require"
  exit 1
fi
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  file:*)
    echo "  ✗ FATAL: DATABASE_URL points at a SQLite file: $DATABASE_URL"
    echo "    This app moved to Postgres because a local file does not survive"
    echo "    a restart on hosts with an ephemeral filesystem. Set DATABASE_URL"
    echo "    to a postgresql:// connection string."
    exit 1
    ;;
  *)
    echo "  ✗ FATAL: DATABASE_URL is not a Postgres connection string."
    echo "    Expected it to start with postgresql:// or postgres://"
    exit 1
    ;;
esac
# Print the host only — the connection string contains the password.
echo "  ✓ DATABASE_URL is set (host: $(echo "$DATABASE_URL" | sed -e 's#^[^@]*@##' -e 's#[/?].*$##'))"

# Report the upload backend so a missing R2 config is visible in deploy logs
# as well as on /api/health.
if [ -n "$R2_ACCOUNT_ID" ] && [ -n "$R2_ACCESS_KEY_ID" ] \
   && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$R2_BUCKET" ]; then
  echo "  ✓ uploads → Cloudflare R2 (bucket: $R2_BUCKET)"
else
  echo "  ⚠ uploads → LOCAL DISK. All four of R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,"
  echo "    R2_SECRET_ACCESS_KEY, R2_BUCKET must be set to use R2. On a host"
  echo "    without a persistent disk, uploaded images WILL be lost on restart."
fi

# 2. Push schema (idempotent — only creates/alters tables, never drops data).
echo "=== Applying database schema ==="
npx prisma db push --skip-generate --accept-data-loss=false

# 3. Core seed (admin + themes + wilayas). Idempotent upserts.
echo "=== Seeding core data (admin, themes, wilayas) ==="
npx tsx prisma/seed.ts

# 4. Demo content seed. Every create inside it is gated by an existence check,
#    so it only fills gaps rather than overwriting real content.
#
#    Set SKIP_DEMO_SEED=1 once the store holds real products. This mattered
#    little while the database was wiped on every restart, but against a
#    persistent Postgres the seed now runs on a store you actually use — and
#    any demo page you deliberately delete would reappear on the next deploy.
if [ -n "$SKIP_DEMO_SEED" ]; then
  echo "=== Demo content seed SKIPPED (SKIP_DEMO_SEED is set) ==="
else
  echo "=== Seeding demo content ==="
  npx tsx prisma/seed-demo.ts || echo "  ⚠ demo seed skipped (may already be populated)"
fi

echo "=== Starting Next.js server on port $PORT ==="
exec node server.js
