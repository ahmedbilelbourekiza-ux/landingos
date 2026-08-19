import { asPlatform, withTenant } from "@landingos/db";

// Relative, not `@/lib/meta/crypto`: the alias only resolves inside Next's
// build, and the suite imports this module from bare node.
import { encryptToken, revealStoredSecret } from "../meta/crypto.ts";

/* =============================================================================
 * LB.14c option (b) — adding a verified custom domain to Render, automatically.
 *
 * The gap this closes (measured in the LB.14c scoping): a merchant can claim,
 * verify and mark a domain primary, and it still 403s at Render's edge until
 * the OPERATOR adds the hostname to the service by hand. Option (b) automates
 * that step through Render's API, keyed on the exact transition the proposal
 * names: a domain becoming VERIFIED + PRIMARY.
 *
 * ⚠ NO LIVE CALL HAS EVER BEEN MADE FROM THIS MODULE. The suite exercises it
 * against a local stub (the config row carries its own apiBase — the
 * AiProvider/ZR-carrier pattern), and no real credential exists in any
 * database. Installing the real credential and the first live test are the
 * user's attended decision — NEXT_STEPS §LB.14c records it.
 *
 * THE CREDENTIAL is a PlatformCredential row (key "render-domains") holding
 * an AES-256-GCM-encrypted JSON config {apiKey, serviceId, apiBase?} — the
 * meta/crypto pattern, key derived from AUTH_SECRET. It is the OPERATOR's
 * secret: no route selects it into a response, the reader below decrypts
 * server-side, and `scripts/set-render-credential.ts` is the attended writer.
 *
 * UNCONFIGURED IS A FIRST-CLASS STATE, not an error: without the row the
 * automation returns quietly and the documented manual step (option a)
 * remains exactly what it was. A merchant's verify/set-primary action must
 * NEVER fail because the operator has not set a credential.
 *
 * THE OUTCOME IS RECORDED on the TenantDomain row (renderState/renderDetail/
 * renderSyncedAt) so a later screen can show progress and a failed attempt is
 * a fact, not a log line. Certificate polling is BOUNDED (a few short
 * attempts inside the post-commit phase — the response deliberately waits,
 * the afterCommit contract); a certificate still pending when the budget ends
 * leaves state "certificate_pending", which a later attempt may advance.
 * ========================================================================== */

export const RENDER_CREDENTIAL_KEY = "render-domains";

export interface RenderDomainsConfig {
  readonly apiKey: string;
  readonly serviceId: string;
  /** Overridable for the suite's stub; defaults to Render's real API. */
  readonly apiBase?: string;
}

const DEFAULT_API_BASE = "https://api.render.com";

/* Bounded certificate polling: attempts × delay is worst-case added latency
 * on the merchant's verify/set-primary response when a certificate is slow —
 * kept deliberately small; "certificate_pending" is an honest resting state. */
const CERT_POLL_ATTEMPTS = 3;
const CERT_POLL_DELAY_MS = 1_500;

export interface RenderWireRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

/** The wire shapes, PURE (the ai-complete rule): assertable without a server. */
export function buildAddDomainRequest(cfg: RenderDomainsConfig, hostname: string): RenderWireRequest {
  const base = (cfg.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  return {
    url: `${base}/v1/services/${encodeURIComponent(cfg.serviceId)}/custom-domains`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: { name: hostname },
  };
}

export function buildGetDomainRequest(cfg: RenderDomainsConfig, hostname: string): RenderWireRequest {
  const base = (cfg.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  return {
    url: `${base}/v1/services/${encodeURIComponent(cfg.serviceId)}/custom-domains/${encodeURIComponent(hostname)}`,
    method: "GET",
    headers: { authorization: `Bearer ${cfg.apiKey}` },
  };
}

/** Encrypt + upsert the config row. The attended script calls this; tests
 * call it against dev with a stub base. Never logs the key. */
export async function storeRenderCredential(cfg: RenderDomainsConfig): Promise<void> {
  const value = encryptToken(JSON.stringify(cfg));
  await asPlatform().platformCredential.upsert({
    where: { key: RENDER_CREDENTIAL_KEY },
    create: { key: RENDER_CREDENTIAL_KEY, value },
    update: { value },
  });
}

/** Null when unconfigured OR undecryptable/malformed — the automation treats
 * every broken state as "not configured" rather than failing a merchant
 * action over an operator-side problem (it records nothing in that case). */
export async function readRenderCredential(): Promise<RenderDomainsConfig | null> {
  const row = await asPlatform().platformCredential.findUnique({
    where: { key: RENDER_CREDENTIAL_KEY },
    select: { value: true },
  });
  if (!row) return null;
  try {
    const cfg = JSON.parse(revealStoredSecret(row.value)) as RenderDomainsConfig;
    return cfg.apiKey && cfg.serviceId ? cfg : null;
  } catch {
    return null;
  }
}

async function callRender(wire: RenderWireRequest): Promise<{ status: number; json: any }> {
  const res = await fetch(wire.url, {
    method: wire.method,
    headers: wire.headers,
    ...(wire.body === undefined ? {} : { body: JSON.stringify(wire.body) }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* status is enough */ }
  return { status: res.status, json };
}

/** Render's answer for a domain, reduced to the two facts we act on. */
function readCertificateVerified(json: any): boolean {
  // Render reports per-domain verification; tolerate both the documented
  // field and a bare boolean so the stub and the real API read the same.
  return json?.verificationStatus === "verified" || json?.verified === true;
}

async function recordState(
  tenantId: string,
  domainId: string,
  renderState: string,
  renderDetail: string | null,
): Promise<void> {
  try {
    await withTenant(tenantId, (tx) =>
      (tx as any).tenantDomain.updateMany({
        where: { id: domainId },
        data: { renderState, renderDetail, renderSyncedAt: new Date() },
      }),
    );
  } catch (error) {
    console.error(`[render-domains] record ${domainId}`, error);
  }
}

/**
 * The automation: add the hostname to the Render service, then poll (bounded)
 * for its certificate. Call from afterCommit on the verified+primary
 * transition. Never throws; a merchant's action must not fail over this.
 */
export async function ensureRenderDomain(
  tenantId: string,
  domain: { readonly id: string; readonly domain: string },
): Promise<void> {
  const cfg = await readRenderCredential();
  if (!cfg) return; // Unconfigured: the manual operator step stands, silently.

  try {
    await recordState(tenantId, domain.id, "pending", null);

    const added = await callRender(buildAddDomainRequest(cfg, domain.domain));
    // 409 means the hostname is already on the service — the state this
    // automation exists to reach; everything else non-2xx is a failure worth
    // recording (status only, never a body echo — the SSRF-adjacent rule).
    if (added.status >= 300 && added.status !== 409) {
      await recordState(tenantId, domain.id, "failed", `add answered ${added.status}`);
      return;
    }
    await recordState(tenantId, domain.id, "added", null);

    for (let attempt = 1; attempt <= CERT_POLL_ATTEMPTS; attempt++) {
      const got = await callRender(buildGetDomainRequest(cfg, domain.domain));
      if (got.status < 300 && readCertificateVerified(got.json)) {
        await recordState(tenantId, domain.id, "certificate_issued", null);
        return;
      }
      if (attempt < CERT_POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, CERT_POLL_DELAY_MS));
      }
    }
    await recordState(tenantId, domain.id, "certificate_pending", null);
  } catch (error) {
    console.error(`[render-domains] ensure ${domain.domain}`, error);
    await recordState(tenantId, domain.id, "failed", "unreachable");
  }
}
