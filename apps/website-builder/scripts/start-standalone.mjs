import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* =============================================================================
 * Run the build that was actually produced — PM.
 *
 * WHY THIS EXISTS. `next.config.ts` sets `output: "standalone"`, and Next 16.2
 * REFUSES `next start` with that configuration. It refuses in the worst
 * possible order: it prints `✓ Ready in 533ms`, THEN the refusal, then exits 1.
 * So `npm run builder:start &` looks healthy for exactly one line and leaves
 * nothing listening on :3000 — which is PROJECT_STATE rule 5's silent port race
 * arriving from the other direction, and it cost most of a session's worth of
 * confusion before the port finally had no other process holding it.
 *
 * WHAT IT RUNS is the same artifact the Dockerfile runs and the same one the
 * deployment serves: `standalone/apps/website-builder/server.js`, one level
 * deeper than a single-app build because `outputFileTracingRoot` is pinned to
 * the workspace root. Verifying against anything else means verifying against
 * something that will never be deployed.
 *
 * THE TWO COPIES ARE NOT OPTIONAL. Next deliberately leaves `public/` and
 * `.next/static/` out of the standalone bundle, and the Dockerfile copies both
 * in as separate layers (see its own comment: "Static assets Next.js does NOT
 * bundle into standalone"). Without them the pages render and every stylesheet,
 * script and committed image 404s — a failure that looks like a broken build
 * rather than a missing copy.
 * ========================================================================== */

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const standalone = path.join(app, ".next", "standalone", "apps", "website-builder");
const server = path.join(standalone, "server.js");

if (!fs.existsSync(server)) {
  console.error(
    `No standalone build at ${server}.\n` +
      "Run `npm run builder:build` from the repo root first.",
  );
  process.exit(1);
}

/** Mirror a directory into the standalone tree, replacing what is there. */
function mirror(from, to) {
  if (!fs.existsSync(from)) return;
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

mirror(path.join(app, "public"), path.join(standalone, "public"));
mirror(path.join(app, ".next", "static"), path.join(standalone, ".next", "static"));

const port = process.env.PORT ?? "3000";
console.log(`standalone server on :${port} — ${server}`);

// `--env-file` rather than reading it here: the server process is the one that
// needs the variables, and a parent that parsed them would be a second answer
// to what the environment is.
const child = spawn(
  process.execPath,
  [`--env-file=${path.join(app, ".env")}`, server],
  { cwd: standalone, stdio: "inherit", env: { ...process.env, PORT: port } },
);

child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
