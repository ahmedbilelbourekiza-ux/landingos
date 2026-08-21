import { asPlatform, withTenant } from "@landingos/db";

// Relative, not `@/lib/...`: the alias only resolves inside Next's build, and
// the suite imports this module from bare node. Same reason as render-domains.
import { encryptToken, decryptToken, revealStoredSecret } from "../meta/crypto.ts";
import {
  buildInsightsRequest,
  parseInsightsRows,
  type DailySpendRow,
  type DateRange,
  type MetaAdsConfig,
} from "./spend-math.ts";

/* =============================================================================
 * LB.23 — pulling REAL ad spend from Meta (Path A), and storing it unconverted.
 *
 * PATH A, and why that is the whole of it: this app reads ad accounts the
 * operator ALREADY OWNS, using one `ads_read` token. Meta requires App Review
 * and Business Verification when an app reads accounts belonging to OTHER
 * businesses — the merchant-facing flow — and none of that applies here. There
 * is no OAuth flow in this module, no redirect URI and no app secret, because
 * Path A needs none of the three. See NEXT_STEPS §LB.23.
 *
 * SCOPE, MEASURED: the token reaches NINE ad accounts. Exactly one of them
 * runs ads (`Atlas Accounts 6`), and the other eight are idle or reserved for
 * future stores. So an account is a ROW a tenant owns, not an env var and not
 * a loop over everything the token can see — pulling all nine would attribute
 * eight stores' worth of nothing to whoever synced last.
 *
 * `ads_read` is READ-ONLY. Nothing in this module can create, pause or alter
 * an ad, and no request here is anything but a GET.
 *
 * WHAT IS NOT HERE, deliberately:
 *   - Currency conversion. See the header of `spend-math.ts`; the ERP
 *     calculator owns the rate and this module stores USD as reported.
 *   - Campaign / creative breakdown. It is NOT buildable from stored data:
 *     `deriveSource` (AN.1) keeps `fbclid` only as the literal string
 *     "fbclid" and the click id itself is opaque — no Meta API turns one back
 *     into a campaign. It needs the ad links tagged with `{{campaign.name}}`
 *     macros in Ads Manager FIRST, and tagging is not retroactive. That is an
 *     operational prerequisite, not a coding task.
 * ========================================================================== */

const META_ADS_CREDENTIAL_KEY = "meta-ads";

/* -----------------------------------------------------------------------------
 * THE TOKEN ON AN AD ACCOUNT ROW — encrypted only, never plaintext.
 *
 * `revealStoredSecret` returns its input UNCHANGED when the input is not in
 * `iv:tag:ciphertext` form. That fallback exists so LB.5-era rows written
 * before encryption could still be read, and for THIS credential it is a trap:
 * it would let a live ads token sit in the clear in the database and still
 * "work", so nothing would ever surface the mistake.
 *
 * So this reader does NOT call it. A value that does not look encrypted is
 * refused outright — treated as no credential at all — which fails in the safe
 * direction: the console says "not connected" instead of quietly using a
 * plaintext secret.
 * -------------------------------------------------------------------------- */

const ENCRYPTED_SHAPE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

/** True only for the AES-256-GCM stored form. Exported so a test can pin that
 * the plaintext path is unreachable for this credential. */
export function isEncryptedSecret(stored: string | null | undefined): boolean {
  return typeof stored === "string" && ENCRYPTED_SHAPE.test(stored);
}

/**
 * The token stored on an AdAccount row, or null.
 *
 * Null when absent, when it is not in the encrypted form (see above), or when
 * it will not decrypt — every broken state reads as "not connected" rather
 * than throwing into a merchant's screen.
 */
export function readAccountToken(stored: string | null | undefined): string | null {
  if (!isEncryptedSecret(stored)) return null;
  try {
    const plain = decryptToken(stored as string);
    return plain.trim() ? plain : null;
  } catch {
    return null;
  }
}

/** Encrypt on the way in. One call site for the route, so nothing can store a
 * bare token by taking a different path. */
export function sealAccountToken(plaintext: string): string {
  return encryptToken(plaintext);
}

/** Encrypt + upsert the credential row. An attended script calls this; the
 * token is never logged, never selected into a response, and never returned
 * by any route. */
export async function storeMetaAdsCredential(cfg: MetaAdsConfig): Promise<void> {
  const value = encryptToken(JSON.stringify(cfg));
  await asPlatform().platformCredential.upsert({
    where: { key: META_ADS_CREDENTIAL_KEY },
    create: { key: META_ADS_CREDENTIAL_KEY, value },
    update: { value },
  });
}

/** Null when unconfigured OR undecryptable/malformed. Every broken state reads
 * as "not configured" so an operator-side problem never fails a merchant
 * action — the render-domains rule, applied again. */
export async function readMetaAdsCredential(): Promise<MetaAdsConfig | null> {
  const row = await asPlatform().platformCredential.findUnique({
    where: { key: META_ADS_CREDENTIAL_KEY },
    select: { value: true },
  });
  if (!row) return null;
  try {
    const cfg = JSON.parse(revealStoredSecret(row.value)) as MetaAdsConfig;
    return cfg.token && cfg.accountId ? cfg : null;
  } catch {
    return null;
  }
}

export interface FetchOutcome {
  readonly ok: boolean;
  readonly rows: readonly DailySpendRow[];
  /** Present only when ok is false. Safe to log — never contains the token. */
  readonly error?: string;
}

/**
 * One GET to the insights endpoint. Errors are RETURNED, not thrown: a sync is
 * a background job and a Meta outage must not take a console screen down with
 * it. The message is Meta's own `error.message` when there is one, so a
 * revoked token says so instead of surfacing as an empty result — silent zeros
 * in a profit screen are worse than a stated error.
 */
export async function fetchDailySpend(
  cfg: MetaAdsConfig,
  range: DateRange,
): Promise<FetchOutcome> {
  let wire;
  try {
    wire = buildInsightsRequest(cfg, range);
  } catch (e) {
    return { ok: false, rows: [], error: (e as Error).message };
  }

  try {
    const res = await fetch(wire.url, { method: "GET", headers: wire.headers });
    const json: unknown = await res.json().catch(() => null);

    const metaError = (json as { error?: { message?: string } } | null)?.error;
    if (metaError) {
      return { ok: false, rows: [], error: metaError.message ?? "Meta returned an error" };
    }
    if (!res.ok) {
      return { ok: false, rows: [], error: `Meta responded ${res.status}` };
    }
    return { ok: true, rows: parseInsightsRows(json) };
  } catch (e) {
    return { ok: false, rows: [], error: (e as Error).message };
  }
}

export interface SyncResult {
  readonly ok: boolean;
  readonly written: number;
  readonly error?: string;
}

/**
 * Pull a window and upsert it, one row per day.
 *
 * IDEMPOTENT on `(tenantId, adAccountId, date)`: re-running the same window
 * overwrites those days rather than adding to them. That is what makes a
 * daily job safe to retry and safe to overlap — Meta restates recent days as
 * attribution settles, and the LAST word should win.
 *
 * `lastSyncedAt` moves only on success, so "never synced" stays
 * distinguishable from "synced and the account genuinely spent nothing".
 */
export async function syncDailySpend(
  tenantId: string,
  adAccountRowId: string,
  cfg: MetaAdsConfig,
  range: DateRange,
): Promise<SyncResult> {
  const outcome = await fetchDailySpend(cfg, range);
  if (!outcome.ok) return { ok: false, written: 0, error: outcome.error };

  let written = 0;
  await withTenant(tenantId, async (tx) => {
    for (const row of outcome.rows) {
      // `new Date(YYYY-MM-DD)` is parsed as UTC midnight, which is what a
      // DATE column stores. The day itself is the ACCOUNT's day as Meta
      // reported it — we are recording their boundary, not imposing ours.
      const date = new Date(`${row.date}T00:00:00.000Z`);
      await tx.adSpendDaily.upsert({
        where: {
          tenantId_adAccountId_date: { tenantId, adAccountId: adAccountRowId, date },
        },
        create: {
          tenantId,
          adAccountId: adAccountRowId,
          date,
          spend: row.spend,
          currency: row.currency,
          impressions: row.impressions,
          clicks: row.clicks,
        },
        update: {
          spend: row.spend,
          currency: row.currency,
          impressions: row.impressions,
          clicks: row.clicks,
          syncedAt: new Date(),
        },
      });
      written += 1;
    }
    await tx.adAccount.update({
      where: { id: adAccountRowId },
      data: { lastSyncedAt: new Date() },
    });
  });

  return { ok: true, written };
}

export interface ChannelPerformance {
  readonly rows: readonly DailySpendRow[];
  readonly orders: number;
  readonly revenueMinor: string;
}

/**
 * The read side: spend rows for a window, beside the orders AN.1 already
 * attributed to the same channel.
 *
 * The join key is `SalesOrder.sourceChannel`, which AN.1 snapshots at
 * checkout from the same server-side derivation the visit beacon uses — so no
 * join against raw visits is needed and pruning them later changes nothing.
 *
 * ⚠ `facebook` AND `instagram` are counted TOGETHER on purpose. Meta reports
 * spend per AD ACCOUNT, which covers both placements, while AN.1 splits them
 * into two channels. Counting only `facebook` against an account that also
 * bought Instagram placements would overstate cost-per-order on one and
 * invent a free channel on the other.
 */
export const META_CHANNELS = ["facebook", "instagram"] as const;

export async function metaChannelPerformance(
  tenantId: string,
  adAccountRowId: string,
  range: DateRange,
): Promise<ChannelPerformance> {
  const since = new Date(`${range.since}T00:00:00.000Z`);
  const until = new Date(`${range.until}T23:59:59.999Z`);

  return withTenant(tenantId, async (tx) => {
    const spendRows = await tx.adSpendDaily.findMany({
      where: { tenantId, adAccountId: adAccountRowId, date: { gte: since, lte: until } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        spend: true,
        currency: true,
        impressions: true,
        clicks: true,
      },
    });

    const orders = await tx.salesOrder.findMany({
      where: {
        tenantId,
        sourceChannel: { in: [...META_CHANNELS] },
        createdAt: { gte: since, lte: until },
      },
      select: { totalPrice: true },
    });

    const revenueMinor = orders
      .reduce((sum, o) => sum + BigInt(Math.round(Number(o.totalPrice) * 100)), 0n)
      .toString();

    return {
      rows: spendRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        spend: r.spend.toString(),
        currency: r.currency,
        impressions: r.impressions,
        clicks: r.clicks,
      })),
      orders: orders.length,
      revenueMinor,
    };
  });
}

export type RefreshOutcome =
  | { readonly ok: true; readonly written: number; readonly days: number }
  | { readonly ok: false; readonly code: "NO_ACCOUNT" | "NO_CREDENTIAL" | "UPSTREAM"; readonly error?: string };

/**
 * LB.23 — the "Refresh spend" action, end to end, for ONE tenant's account.
 *
 * Resolves the token from the account ROW (encrypted at rest, never plaintext
 * — see `readAccountToken`), pulls the window, and upserts. Returns a CODE
 * rather than a message so the console can map it to a translated string; the
 * upstream text from Meta rides along untranslated because it is Meta's, and
 * inventing our own wording for it would hide which system refused.
 *
 * A missing credential is its own code, not an upstream failure: one is the
 * merchant's next action ("paste your token"), the other is not.
 */
export async function refreshAccountSpend(
  tenantId: string,
  adAccountRowId: string,
  range: DateRange,
): Promise<RefreshOutcome> {
  const account = await withTenant(tenantId, (tx) =>
    tx.adAccount.findFirst({
      where: { id: adAccountRowId },
      select: { id: true, accountId: true, accessToken: true, isActive: true },
    }),
  );
  if (!account) return { ok: false, code: "NO_ACCOUNT" };

  const token = readAccountToken(account.accessToken);
  if (!token) return { ok: false, code: "NO_CREDENTIAL" };

  const result = await syncDailySpend(
    tenantId,
    account.id,
    { token, accountId: account.accountId },
    range,
  );
  if (!result.ok) return { ok: false, code: "UPSTREAM", error: result.error };
  return { ok: true, written: result.written, days: result.written };
}
