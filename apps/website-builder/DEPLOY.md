# Deploying the LandingOS platform

**Rewritten in LB.9.** The previous version of this file described the
pre-platform single-store app; its Docker pipeline could neither build the
monorepo (the deps stage predated most of the workspace) nor boot it safely
(the entrypoint pushed the legacy single-tenant schema on every start). Both
are replaced. If you are reading this to continue deployment work, also read
`BUILDER_HANDOFF.md` §11 and the LB.9 commit message.

One image serves the whole platform — builder console, ERP console, platform
surfaces, public storefront. Which products a tenant sees is decided by their
subscription's entitlements, never by what was deployed.

| What | Where it lives | Why |
|---|---|---|
| Database | External **Postgres** (Neon), RLS enforced | Multi-tenant isolation; nothing durable in the container |
| Uploaded images | **Cloudflare R2** | Ephemeral filesystems lose local uploads |
| Everything else | The container | Rebuilt on every deploy, nothing to keep |

---

## The build

Docker, build context = **repository root**, Dockerfile =
`apps/website-builder/Dockerfile`:

```bash
docker build -f apps/website-builder/Dockerfile -t landingos .
```

Three stages: `deps` installs only this product's dependency graph with npm
pinned to **11.16.0** (the version that generated the lockfile — if you
regenerate `package-lock.json`, use `npx npm@11.16.0 install
--package-lock-only` so the two stay aligned); `builder` generates **both**
Prisma clients in-image (the platform client from `packages/db/prisma/schema`
— the one every route queries through — and the app-local type-source client)
then runs `next build`; `runner` carries the standalone server, static and
public assets, the platform schema for the boot probe, and the generated
client **at the path the bundled code searches**
(`apps/website-builder/packages/db/prisma/client` — the standalone bundle
rewrites the client's `__dirname` relative to the app directory, which was
found by booting the artifact, not by reading docs).

The deps stage copies **every workspace manifest** — `npm ci` validates the
lockfile against the whole workspace, so adding a package to the workspace
means adding its `package.json` to that COPY list or the build fails there,
deliberately loudly.

## What the container does at boot — and refuses to do

`docker-entrypoint.sh`, on every start:

1. Verifies `AUTH_SECRET` and a Postgres database URL
   (`PLATFORM_DATABASE_URL` preferred, `DATABASE_URL` accepted, normalised to
   both names). Refuses to start otherwise.
2. Reports the upload backend (R2 vs local disk) into the deploy log.
3. **Verifies** the database is reachable and carries the platform schema
   (a `SELECT` against `Tenant` through `prisma db execute`). On failure it
   prints the migration runbook and exits.
4. Starts the standalone server.

**The container never runs DDL and never seeds.** The runtime credential is
`landingos_app` — `NOBYPASSRLS`, owner of nothing — which is what makes
row-level security real, and equally what makes `prisma db push` impossible
from the container. This is a deliberate reversal of the legacy entrypoint,
which pushed its schema and re-seeded demo content on every boot.

## Preparing a database (one-time, from the repository)

Run with `MIGRATE_DATABASE_URL` (the owner credential, direct endpoint) set in
`packages/db/.env`:

```bash
npm run setup:roles    --workspace @landingos/db   # once per database: creates landingos_app, NOBYPASSRLS
npm run push           --workspace @landingos/db   # apply the schema
npm run rls            --workspace @landingos/db   # enable + force RLS on every tenant-scoped table
npm run seed:reference --workspace @landingos/db   # 58 wilayas, 537 baladias
npm run seed:demo      --workspace @landingos/db   # OPTIONAL: the demo tenant
```

Re-run `push` + `rls` for schema changes. The same sequence is what the
entrypoint's refusal message prints.

## Environment variables (Render → Environment)

Required — the container refuses to start without these:

| Variable | Value |
|---|---|
| `PLATFORM_DATABASE_URL` | The **`landingos_app`** connection string (pooled endpoint is fine) |
| `AUTH_SECRET` | Random 32+ bytes. ⚠️ Signs sessions **and** derives the AES key for stored webhook secrets and tracking tokens — rotating it signs everyone out and makes every stored integration credential undecryptable |

Required for durable image uploads — all four, or uploads fall back to local
disk (lost on restart):

| Variable | Value |
|---|---|
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | From an R2 API token with Object Read & Write |

Recommended / optional:

| Variable | Why |
|---|---|
| `R2_PUBLIC_BASE_URL` | Images redirect to Cloudflare's CDN instead of proxying through the app |
| `WORKER_SECRET` | Only when the ERP's scheduled jobs run — shared with the `services/worker` process, which calls `POST /api/jobs/tick`. Without it the tick answers 404 and no scheduled work happens (fails closed) |
| `CHECKOUT_RATE_LIMIT` / `DRAFT_RATE_LIMIT` | Per-IP limits on the public writes; defaults 10 and 60 per 5 minutes. Raise only for load tests |
| `META_GRAPH_BASE` / `TIKTOK_API_BASE` / `GA4_API_BASE` | **Test overrides only.** Point the server-side conversion events at a stub receiver. Never set in production — unset means the real endpoints |

Do NOT set: `PORT` (the host provides it), `UPLOADS_DIR` (the entrypoint sets
it), any `MIGRATE_DATABASE_URL` (the owner credential has no business in the
runtime environment).

## Render settings

- **Runtime** Docker · **Branch** `main` · root directory = repository root
- **Dockerfile Path** `apps/website-builder/Dockerfile`
- **Docker Build Context Directory** `.`
- **Health check** `/api/health` — `checks.database: "ok"` and
  `checks.referenceData: "58 wilayas"` mean the platform build is live and
  migrated. (The legacy build answered with a `storage` object instead — that
  shape appearing means the old image is still serving.)
- **Worker (later, ERP tenants only):** a second service running
  `services/worker` with `WORKER_TARGET` = the web service origin and the same
  `WORKER_SECRET`. Not needed for a builder-only launch.

## Verifying a deploy

```bash
curl -s https://<service>.onrender.com/api/health
```

```json
{"success":true,"data":{"service":"LandingOS","version":"0.1.0",
 "checks":{"database":"ok","referenceData":"58 wilayas","uploads":"r2"}}}
```

Then use it: open `/{tenant-slug}`, sign in at `/console/login`, confirm a
product image loads. The suites can be pointed at any deployment:
`CONSOLE_URL=https://… node --env-file=.env --test test/storefront.test.ts`.

## Troubleshooting

**Boot fails with the migration runbook** — the database is unreachable from
the host, or the schema was never applied. Run the one-time sequence above.

**Health says `"uploads":"local disk"` in production** — at least one R2
variable is missing; all four are required together.

**Health still shows the legacy `storage` shape** — the old image is serving:
the deploy failed (check the Dockerfile-path setting) or never triggered.

**Login works but every list is empty** — the runtime URL is not the
`landingos_app` credential, or RLS policies were never applied (`npm run rls`).
RLS denies by returning zero rows, not by erroring.

**Stored webhook secrets / tracking tokens stopped decrypting** —
`AUTH_SECRET` changed. They cannot be recovered; re-enter them in
Settings → Integrations.

**`npm ci` fails in the deps stage naming a workspace** — a package was added
to the workspace without adding its manifest to the Dockerfile's COPY list.

**`npm ci` fails with `Missing: <pkg> from lock file`** — the lockfile was
regenerated by a different npm major than the image pins. Regenerate with
`npx npm@11.16.0 install --package-lock-only` and verify with
`npx npm@11.16.0 ci --dry-run`.

## Other hosts

The same image runs anywhere Docker does — `railway.json` at the repo root
already declares the equivalent settings for Railway. Requirements are
identical: the environment variables above, and a database prepared with the
one-time sequence. On a host with a real disk, mount a volume at `/app/data`
to keep local uploads instead of R2; the database is always external.
