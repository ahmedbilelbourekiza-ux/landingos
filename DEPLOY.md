# Deploying LandingOS to Railway

This guide deploys your app to **Railway** — a hosting service that runs Docker
containers with persistent disks. It's the right choice for this app because
LandingOS uses a SQLite database file + local image uploads, which need a
persistent filesystem (serverless hosts like Vercel can't do this).

You'll end up with a **public HTTPS URL** like `https://landingos-production.up.railway.app`
that stays up 24/7, with your data preserved across redeploys.

**Total time:** ~20–30 minutes. **Cost:** Free trial (no credit card to start),
then ~$5/month after the trial.

---

## Prerequisites

You need:
- A **GitHub** account (free) — your code will live there.
- A **Railway** account (free to start) — sign up at https://railway.app.

---

## Step 1 — Push the code to GitHub

The deploy files (`Dockerfile`, `docker-entrypoint.sh`, `railway.json`,
`.dockerignore`) are already in your project. You need to get the project onto
GitHub so Railway can build it.

### Option A: Create a new GitHub repo (recommended)

1. Go to https://github.com/new
2. Repository name: `landingos` (or whatever you like)
3. Set it **Private** (your code + demo data shouldn't be public)
4. **Do not** check "Add a README" or ".gitignore" (the project has them)
5. Click **Create repository**

Then, in your terminal at the project folder, run:

```bash
git add -A
git commit -m "Add production Docker deploy + configurable admin credentials"
git remote add origin https://github.com/YOUR_USERNAME/landingos.git
git branch -M main
git push -u origin main
```

(Replace `YOUR_USERNAME` with your GitHub username.)

> **Note:** `.env` is gitignored, so your local `AUTH_SECRET` won't be pushed.
> That's correct — you'll set secrets directly on Railway.

### Option B: Upload a ZIP

If you don't want to use git, you can upload the project folder as a ZIP on
GitHub ("uploading an existing file" on the new-repo page). But git is strongly
recommended — it lets you redeploy by just pushing updates.

---

## Step 2 — Create the Railway project

1. Go to https://railway.app and **sign in** with GitHub.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your `landingos` repository.
4. Railway detects the `Dockerfile` and `railway.json` automatically and starts
   building. The first build takes ~3–5 minutes (installing deps + Next build).

---

## Step 3 — Add a persistent Volume (REQUIRED)

This is the critical step — without it, your database and uploaded images get
wiped on every redeploy.

1. In your Railway project, click the **service** (the box with your app name).
2. Go to the **Settings** tab → **Volumes** → **Add Volume**.
3. Set the **Mount path** to: `/app/data`
   - This is where the Dockerfile stores the SQLite DB (`custom.db`).
4. Click **Add**.

Railway now preserves everything under `/app/data` across redeploys and restarts.

---

## Step 4 — Set environment variables (REQUIRED)

Still in your service, go to the **Variables** tab and add these:

| Variable | Value | Why |
|---|---|---|
| `AUTH_SECRET` | a random string (generate below) | Signs login sessions. **Required** — the app won't start without it. |
| `ADMIN_USERNAME` | `admin` (or your choice) | Your login username. |
| `ADMIN_PASSWORD` | a strong password you choose | Your login password. |

### Generate AUTH_SECRET

Run this in your terminal and copy the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Or use any online base64 random generator. Paste the result as the `AUTH_SECRET`
value.

> ⚠️ **Use a strong `ADMIN_PASSWORD`** (10+ chars, mix of letters/numbers).
> The app will be on a public URL — `admin123` will be guessed within minutes.

After adding the variables, Railway automatically redeploys.

---

## Step 5 — Generate your public URL

1. Go to **Settings** → **Networking** → **Generate Domain**.
2. Railway gives you a URL like `https://landingos-production.up.railway.app`.
3. Wait ~1 minute for the redeploy, then open the URL.

You should see the storefront homepage. Go to `YOUR_URL/login` and sign in with
the `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set.

🎉 **You're live.** The app is now a real, publicly accessible product.

---

## How it works (what the deploy does)

On every container start, `docker-entrypoint.sh` runs:

1. **Creates `/app/data`** (the persistent volume) if it's empty.
2. **Checks `AUTH_SECRET`** — fails fast with a clear message if missing.
3. **`prisma db push`** — creates/updates the SQLite tables (idempotent, never
   drops data).
4. **Core seed** — creates the admin account (using your `ADMIN_PASSWORD`),
   themes, and the 58 Algerian wilayas. Skips anything that already exists.
5. **Demo seed** — populates categories, landing pages, and orders **only if
   the database is empty**. Once you start using it for real, your data is
   never overwritten.
6. **Starts the Next.js server** on port 3000.

Railway's health check pings `/api/health` and only routes traffic once the
server responds.

---

## Updating the app later

After making code changes locally:

```bash
git add -A
git commit -m "describe your change"
git push
```

Railway automatically rebuilds and redeploys on every push. Your database and
uploads are safe (they're on the volume).

---

## Troubleshooting

**Build fails on Railway:**
- Check the **Deploy Logs** tab in Railway for the error.
- Most common cause: a code error. The Dockerfile uses `ignoreBuildErrors: true`
  for TypeScript, so type errors won't block the build, but real syntax errors
  will.

**App starts but login fails / "AUTH_SECRET_MISSING":**
- You forgot to set `AUTH_SECRET` in the Variables tab, or set it to empty.

**Data disappeared after a redeploy:**
- You didn't add the Volume in Step 3, or the mount path isn't `/app/data`.

**Want to reset the database:**
- In Railway, **Settings → Volumes → Delete** the volume, then trigger a
  redeploy. The container recreates a fresh database on next start.

---

## Alternatives

If Railway doesn't work for you, the same `Dockerfile` works on:
- **Render** — https://render.com (similar setup, mount disk at `/app/data`)
- **Fly.io** — https://fly.io (create a volume, mount at `/app/data`)
- **Any VPS** (DigitalOcean, Hetzner) with Docker installed —
  `docker build -t landingos . && docker run -p 80:3000 -v landingos-data:/app/data landingos`
