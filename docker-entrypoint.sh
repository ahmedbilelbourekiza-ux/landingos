#!/bin/sh
# Container startup script.
#
# Runs on every container start (including redeploys). Steps:
#   1. Ensure the persistent data dir + uploads dir exist.
#   2. Push the Prisma schema to the SQLite file (creates tables if missing,
#      leaves existing data intact). Idempotent.
#   3. Seed core data (admin account, themes, wilayas) — upserts, safe to rerun.
#   4. Seed demo content (categories, landings, orders) — skips anything that
#      already exists, so it only populates a fresh database.
#   5. Start the Next.js standalone server.
#
# The SQLite file and uploads live on a persistent volume mounted at /app/data,
# so a redeploy does NOT lose your data.

set -e

DATA_DIR="/app/data"
UPLOADS_DIR="/app/public/uploads"

echo "=== LandingOS container starting ==="

# 1. Ensure dirs exist (the volume mount may start empty).
mkdir -p "$DATA_DIR" "$UPLOADS_DIR"
echo "  ✓ data dir: $DATA_DIR"
echo "  ✓ DATABASE_URL: $DATABASE_URL"

# If uploads volume is empty, copy the default product images shipped in the
# image so storefront landing pages render their gallery images on first boot.
if [ -z "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  echo "  ✓ uploads volume empty — initializing with default images"
fi

# Fail fast if AUTH_SECRET is not set — the app cannot sign sessions without it.
if [ -z "$AUTH_SECRET" ]; then
  echo "  ✗ FATAL: AUTH_SECRET environment variable is not set."
  echo "    Set it on your hosting provider (Railway/Render) to a random string."
  echo "    Generate one with:  openssl rand -base64 32"
  exit 1
fi
echo "  ✓ AUTH_SECRET is set"

# 2. Push schema (idempotent — only creates/alters tables, never drops data).
echo "=== Applying database schema ==="
npx prisma db push --skip-generate --accept-data-loss=false

# 3. Core seed (admin + themes + wilayas). Idempotent upserts.
echo "=== Seeding core data (admin, themes, wilayas) ==="
npx tsx prisma/seed.ts

# 4. Demo content seed (only fills an empty store; skips if data exists).
echo "=== Seeding demo content ==="
npx tsx prisma/seed-demo.ts || echo "  ⚠ demo seed skipped (may already be populated)"

echo "=== Starting Next.js server on port $PORT ==="
exec node server.js
