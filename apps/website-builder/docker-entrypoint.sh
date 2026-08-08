#!/bin/sh
# Container startup — LandingOS platform (LB.9).
#
# Runs on every container start. Steps:
#   1. Verify required config (AUTH_SECRET, a Postgres database URL) and
#      report the upload backend. Refuses to start on a misconfiguration.
#   2. Verify the database is REACHABLE and CARRIES THE PLATFORM SCHEMA.
#      This container never runs DDL: the runtime credential is landingos_app
#      (NOBYPASSRLS, owner of nothing) — which is what makes row-level
#      security real, and equally what makes `prisma db push` impossible from
#      here. Schema pushes, role setup, RLS and reference seeding are
#      deliberate migration steps run from the repository:
#
#        npm run setup:roles     --workspace @landingos/db   # once per database
#        npm run push            --workspace @landingos/db
#        npm run rls             --workspace @landingos/db
#        npm run seed:reference  --workspace @landingos/db
#
#      (These read MIGRATE_DATABASE_URL — the owner credential — from
#      packages/db/.env. See DEPLOY.md.)
#   3. Start the Next.js standalone server.
#
# The pre-platform entrypoint pushed the app-local schema and ran the legacy
# single-store seeds on every boot. Against the platform database that would
# have tried to reshape 48 RLS-guarded tables into the old single-tenant
# layout — refused by --accept-data-loss, but as a crash-loop. Verification
# replaced mutation on purpose: boot proves the world is right, it does not
# try to make it right.
#
# APP_ROOT exists so the SAME file is executable outside a container: the
# clean-room verification harness runs this script against a runner-layout
# directory on the dev machine (Docker is not available everywhere), and a
# copy-with-paths-edited would drift from the script that actually ships.
set -e

APP_ROOT="${APP_ROOT:-/app}"
DATA_DIR="$APP_ROOT/data"
# Local-disk fallback for uploads, used only when R2 is not configured.
UPLOADS_DIR="${UPLOADS_DIR:-$DATA_DIR/uploads}"

echo "=== LandingOS platform container starting ==="

# 1a. Scratch/volume dirs.
mkdir -p "$DATA_DIR" "$UPLOADS_DIR"
export UPLOADS_DIR
echo "  + data dir: $DATA_DIR"
echo "  + uploads dir: $UPLOADS_DIR"

# 1b. AUTH_SECRET — signs sessions AND derives the AES key that encrypts
# stored webhook secrets and tracking tokens. Never rotate it casually:
# rotation signs everyone out and makes every stored secret undecryptable.
if [ -z "$AUTH_SECRET" ]; then
  echo "  x FATAL: AUTH_SECRET environment variable is not set."
  echo "    Set it on your hosting provider (Render -> Environment)."
  echo "    Generate one with:  openssl rand -base64 32"
  exit 1
fi
echo "  + AUTH_SECRET is set"

# 1c. The database URL. The platform client prefers PLATFORM_DATABASE_URL and
# falls back to DATABASE_URL (packages/db/src/tenant-client.ts); accept either
# here, normalise to both names, and refuse anything that is not Postgres.
# This must be the RUNTIME credential — landingos_app — not the owner.
EFFECTIVE_DB_URL="${PLATFORM_DATABASE_URL:-$DATABASE_URL}"
if [ -z "$EFFECTIVE_DB_URL" ]; then
  echo "  x FATAL: no database URL is set."
  echo "    Set PLATFORM_DATABASE_URL (preferred) or DATABASE_URL to the"
  echo "    landingos_app connection string, e.g."
  echo "    postgresql://landingos_app:...@host.neon.tech/neondb?sslmode=require"
  exit 1
fi
case "$EFFECTIVE_DB_URL" in
  postgres://*|postgresql://*) ;;
  file:*)
    echo "  x FATAL: the database URL points at a SQLite file."
    echo "    The platform requires Postgres. Set PLATFORM_DATABASE_URL to a"
    echo "    postgresql:// connection string."
    exit 1
    ;;
  *)
    echo "  x FATAL: the database URL is not a Postgres connection string."
    echo "    Expected it to start with postgresql:// or postgres://"
    exit 1
    ;;
esac
export PLATFORM_DATABASE_URL="$EFFECTIVE_DB_URL"
export DATABASE_URL="$EFFECTIVE_DB_URL"
# Print the host only — the connection string contains the password.
echo "  + database URL is set (host: $(echo "$EFFECTIVE_DB_URL" | sed -e 's#^[^@]*@##' -e 's#[/?].*$##'))"

# 1d. Upload backend, visible in deploy logs as well as on /api/health.
if [ -n "$R2_ACCOUNT_ID" ] && [ -n "$R2_ACCESS_KEY_ID" ] \
   && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$R2_BUCKET" ]; then
  echo "  + uploads -> Cloudflare R2 (bucket: $R2_BUCKET)"
else
  echo "  ! uploads -> LOCAL DISK. All four of R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,"
  echo "    R2_SECRET_ACCESS_KEY, R2_BUCKET must be set to use R2. On a host"
  echo "    without a persistent disk, uploaded images WILL be lost on restart."
fi

# 1e. Tracking endpoint overrides — TEST-ONLY variables (DEPLOY.md). If any is
# set in a real deployment, every server-side conversion event (Meta CAPI,
# TikTok Events API, GA4 MP) is silently posted at a stub instead of the ad
# platform: ads keep running, money keeps being spent, and no conversion is
# ever reported. Loud, unmissable, but not fatal — a staging environment may
# point at a stub deliberately.
for OVERRIDE in META_GRAPH_BASE TIKTOK_API_BASE GA4_API_BASE; do
  eval "VALUE=\${$OVERRIDE:-}"
  if [ -n "$VALUE" ]; then
    echo ""
    echo "  !!! WARNING ==========================================================="
    echo "  !!! $OVERRIDE is set: $VALUE"
    echo "  !!! This is a TEST-ONLY override. Server-side conversion events will"
    echo "  !!! go to that address INSTEAD OF the real ad platform. If this is a"
    echo "  !!! production deployment, REMOVE this variable and redeploy."
    echo "  !!! ==================================================================="
    echo ""
  fi
done

# 2. Reachability + schema presence, in one probe. Tenant is the platform's
# root table; selecting from it fails on an unreachable database AND on a
# reachable-but-unmigrated one, with different errors, both fatal here. RLS
# does not interfere: the probe asks whether the TABLE exists, and zero rows
# is success.
echo "=== Verifying database schema ==="
if ! echo 'SELECT 1 FROM "Tenant" LIMIT 1;' | npx prisma db execute \
    --url "$EFFECTIVE_DB_URL" --stdin >/dev/null 2>&1; then
  echo "  x FATAL: the database is unreachable, or the platform schema is not"
  echo "    applied. This container never runs DDL (the runtime role owns"
  echo "    nothing, by design). From the repository, run:"
  echo "      npm run setup:roles    --workspace @landingos/db   # first time"
  echo "      npm run push           --workspace @landingos/db"
  echo "      npm run rls            --workspace @landingos/db"
  echo "      npm run seed:reference --workspace @landingos/db"
  echo "    then redeploy. See DEPLOY.md."
  exit 1
fi
echo "  + schema present (Tenant table reachable)"

# 3. The server. No seeds at boot: demo/dev content is opt-in from the repo
# (npm run seed:demo --workspace @landingos/db), never something a redeploy
# quietly re-creates on a live store.
echo "=== Starting Next.js server on port ${PORT:-3000} ==="
cd "$APP_ROOT/apps/website-builder"
exec node server.js
