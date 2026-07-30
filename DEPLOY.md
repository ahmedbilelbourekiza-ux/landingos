# Deploying LandingOS to Render

This is the live deployment guide for LandingOS. The app runs as a Docker
container on **Render** and keeps **no durable state inside the container**:

| What | Where it lives | Why |
|---|---|---|
| Database | External **Postgres** (Neon) | A local file does not survive a restart |
| Uploaded images | **Cloudflare R2** | Same reason, plus free egress |
| Everything else | The container | Rebuilt on every deploy, nothing to keep |

That split is the whole point of the setup, and it is what makes the **Render
free tier** usable: Render free has an ephemeral filesystem and wipes the
container on every deploy *and* every idle spin-down (~15 minutes of no
traffic). Anything stored inside the container is gone within hours.

> **Why not a Render persistent disk?** Disks require a paid instance. Moving
> the database and images off the box entirely is free and removes the problem
> rather than paying to defer it.

---

## Current deployment

- **Service:** Render Web Service (not a Blueprint — `render.yaml` was dropped
  because Blueprints ask for payment details)
- **Runtime:** Docker · **Branch:** `main` · **Region:** Frankfurt
- **Instance:** Free · **Persistent disk:** none, by design
- **Auto-deploy:** on push to `main`

---

## Environment variables

Set these in **Render → your service → Environment**.

### Required — the container refuses to start without these

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres connection string (see [Database](#database-neon)) |
| `AUTH_SECRET` | Random 32+ byte string |

Generate `AUTH_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> ⚠️ **Never rotate `AUTH_SECRET` casually.** It signs login sessions *and*
> derives the AES key that decrypts stored Meta CAPI access tokens
> (`src/lib/meta/crypto.ts`). Changing it logs everyone out **and** makes every
> saved pixel token undecryptable — you would have to re-enter them.

### Required for image uploads — all four, or none take effect

| Variable | Value |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare Account ID (R2 → Overview) |
| `R2_ACCESS_KEY_ID` | From an R2 API token with Object Read & Write |
| `R2_SECRET_ACCESS_KEY` | From the same token — shown only once |
| `R2_BUCKET` | Your bucket name |

`getR2Config()` returns `null` if **any** one is missing, and uploads silently
fall back to local disk — which on Render means images vanish on restart. There
is no partial mode.

### Recommended

| Variable | Value | Why |
|---|---|---|
| `R2_PUBLIC_BASE_URL` | Bucket's Public Development URL (`https://pub-xxxx.r2.dev`) or a custom domain | Images redirect straight to Cloudflare's CDN instead of being proxied through the app, so they stop consuming Render bandwidth and stop keeping the instance awake |
| `ADMIN_USERNAME` | Your admin username | Defaults to `admin` |
| `ADMIN_PASSWORD` | A strong password | Defaults to `admin123`, which will be guessed on a public URL |
| `SKIP_DEMO_SEED` | `1` | Stops the demo seeder refilling content you deleted. Set this once the store holds real products. |

### Do NOT set

- `PORT` — Render provides it.
- `UPLOADS_DIR` — the entrypoint sets it.

---

## Database (Neon)

1. Sign up at <https://neon.tech> (free tier, no card).
2. Create a project — pick a region near Frankfurt (e.g. `eu-central-1`) to keep
   latency to the Render service low.
3. **Connection Details** → copy the connection string. It looks like:

   ```
   postgresql://user:password@ep-xxx-yyy.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Paste it as `DATABASE_URL` in Render.

Use the **direct (non-pooled)** string. This app runs as one long-lived
container and applies its schema with `prisma db push` on startup — both prefer
a direct connection over PgBouncer. Switch to the `-pooler` host only if you
later hit connection limits.

Neon's free compute auto-suspends after ~5 minutes idle; the first query then
takes roughly a second to wake it. That is fine here, because Render's free
instance is spinning down on a similar schedule anyway.

### Local development

Point your local `.env` at a **separate** database — never production. A Neon
**branch** (Neon → Branches → New Branch) is the easiest way: it gives you an
isolated copy with its own connection string. Running `prisma db push` or the
demo seed against production would otherwise touch real orders.

---

## Deploying

Auto-deploy is on, so a push to `main` is a deploy:

```bash
git push origin main
```

### Order of operations matters

The container **fails fast** on a missing or non-Postgres `DATABASE_URL` — a
deliberate choice, because the alternative is worse: the service would come up
healthy, seed demo content into a throwaway database, and accept real orders
that never appear in the dashboard.

So on a service that has not been migrated yet:

1. Create the Neon database and copy the connection string.
2. Add `DATABASE_URL` (and the R2 variables) in Render.
3. *Then* deploy the Postgres change.

Doing it in the other order takes the site down until step 2 lands.

---

## Verifying a deploy

```bash
curl -s https://landingos.onrender.com/api/health
```

```json
{"success":true,"data":{"status":"ok","service":"LandingOS","version":"0.1.0",
 "storage":{"backend":"r2","cdn":true},"time":"..."}}
```

Read it as:

| Field | Meaning |
|---|---|
| `status: "ok"` | API is up **and** the database connection works |
| `storage.backend: "r2"` | R2 is active — uploads survive restarts |
| `storage.backend: "local"` | ⚠️ In production this means the R2 variables did not take effect |
| `storage.cdn: true` | Images redirect to Cloudflare's CDN |
| `storage.cdn: false` | Bucket is private, images proxy through the app (valid, just slower) |

The container also prints the resolved backend and the database **host** (never
the password) in the Render deploy logs at startup.

Then check the app itself: open the storefront, log in at `/login`, and confirm
a product image loads.

---

## What happens on every container start

`docker-entrypoint.sh`:

1. Creates `/app/data` + `/app/data/uploads` (the local upload fallback).
2. **Verifies `AUTH_SECRET`** — exits with a clear message if missing.
3. **Verifies `DATABASE_URL`** is present and is a `postgresql://` /
   `postgres://` string — exits otherwise, including a specific error if it
   still points at a `file:` SQLite path.
4. Reports whether uploads resolve to R2 or local disk.
5. `prisma db push` — creates/updates tables. Idempotent, never drops data
   (`--accept-data-loss=false`).
6. Core seed — admin account, themes, 58 Algerian wilayas. Idempotent upserts.
7. Demo seed — existence-gated, so it only fills gaps. Skipped entirely when
   `SKIP_DEMO_SEED` is set.
8. Starts the Next.js standalone server on `$PORT`.

---

## Troubleshooting

**`FATAL: DATABASE_URL environment variable is not set`**
Add it in Render → Environment. The container will not start without it.

**`FATAL: DATABASE_URL points at a SQLite file`**
Left over from before the Postgres migration. Replace it with the Neon string.

**Health check says `"backend":"local"` in production**
At least one R2 variable is missing or misspelled. All four are required
together. Check for a trailing space in the pasted value — the code trims, but
a wrong value fails differently.

**Images 404 after a redeploy**
Almost certainly the case above: they were written to local disk and the
container was recycled. Images uploaded *before* R2 was enabled are also gone;
the serving route falls back to disk for them, but that disk no longer exists.
Re-upload them.

**Login fails / `AUTH_SECRET_MISSING`**
`AUTH_SECRET` is unset or empty.

**Saved Meta pixel tokens stopped working**
`AUTH_SECRET` changed. The tokens cannot be recovered — re-enter them in
**Dashboard → Meta Pixels**.

**Build fails on Render**
Check the deploy logs. Note that `next.config.ts` sets
`typescript.ignoreBuildErrors: true`, so type errors do not block a build — a
failure there is a genuine build or dependency problem.

**`npm ci` fails with `Missing: <pkg> from lock file`**
`package.json` and `package-lock.json` disagree — but check the npm *version*
before assuming the lockfile is wrong. npm 10 and npm 11 resolve optional peer
dependencies differently, so a lockfile written by one can be rejected by the
other while installing perfectly on your machine.

The Dockerfile pins `npm@10.9.4` for exactly this reason. Regenerate the
lockfile with the **same** version, never with your local npm:

```bash
npx npm@10.9.4 install --package-lock-only
```

Then verify against both, since a lockfile that satisfies only one is a trap
for the next person:

```bash
npx npm@10.9.4 ci --dry-run
npm ci --dry-run
```

This bit once already: `next` pins the hoisted `@swc/helpers` to `0.5.15` while
a transitive peer of `next-intl` wants `>=0.5.17`. npm 11 omitted the nested
`0.5.23` copy; npm 10 required it, and the Render build died at `npm ci` while
`npm ci` passed locally.

**Database is empty after a deploy**
If this happens *now*, `DATABASE_URL` is pointing somewhere unexpected — check
the host printed in the startup logs. Before the Postgres migration this was
the expected behaviour on every restart.

---

## Other hosts

The same `Dockerfile` runs anywhere Docker does — Railway, Fly.io, or a VPS.
Requirements are the same: provide `DATABASE_URL`, `AUTH_SECRET`, and the R2
variables. On a host with a real disk you may instead mount a volume at
`/app/data` to hold uploads and skip R2, but the database is always external.
