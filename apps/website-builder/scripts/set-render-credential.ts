/* =============================================================================
 * LB.14c option (b) — install the Render credential, ATTENDED.
 *
 * Run by the OPERATOR, by hand, when they decide the domain automation goes
 * live (NEXT_STEPS §LB.14c records that decision as theirs):
 *
 *   cd apps/website-builder
 *   RENDER_API_KEY=rnd_... RENDER_SERVICE_ID=srv-... \
 *     node --env-file=.env --experimental-strip-types scripts/set-render-credential.ts
 *
 * Reads the key/service from the ENVIRONMENT of this one invocation (never
 * stored in any file), encrypts the JSON config with the meta/crypto pattern
 * (AES-256-GCM, key derived from AUTH_SECRET — which must match the app's),
 * and upserts the single PlatformCredential row the automation reads.
 * Optional RENDER_API_BASE overrides the API host (the suite's stub uses it;
 * production should leave it unset).
 *
 * Prints only the masked tail of the key. Deleting the row disables the
 * automation again:  asPlatform().platformCredential.delete({ where: { key:
 * "render-domains" } }) — the manual operator step is the fallback either way.
 * ========================================================================== */

import { asPlatform, disconnect } from "@landingos/db";

import { storeRenderCredential, RENDER_CREDENTIAL_KEY } from "../src/lib/platform/render-domains.ts";
import { maskToken } from "../src/lib/meta/crypto.ts";

const apiKey = process.env.RENDER_API_KEY?.trim();
const serviceId = process.env.RENDER_SERVICE_ID?.trim();
const apiBase = process.env.RENDER_API_BASE?.trim();

if (!apiKey || !serviceId) {
  console.error("RENDER_API_KEY and RENDER_SERVICE_ID are required (env of this invocation only).");
  process.exit(1);
}

await storeRenderCredential({ apiKey, serviceId, ...(apiBase ? { apiBase } : {}) });
const row = await asPlatform().platformCredential.findUnique({
  where: { key: RENDER_CREDENTIAL_KEY },
  select: { updatedAt: true },
});
console.log(
  `Stored ${RENDER_CREDENTIAL_KEY}: key ${maskToken(apiKey)}, service ${serviceId}` +
    `${apiBase ? `, base ${apiBase}` : ""} (encrypted at rest; updated ${row?.updatedAt.toISOString()}).`,
);
await disconnect();
