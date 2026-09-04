import { withTenant } from "@landingos/db";

import { resolveClientIdentity, type HeaderBag } from "./rate-limit.ts";

/* =============================================================================
 * GEO.0 — the Cloudflare geo-header MEASUREMENT, not the geolocation feature.
 *
 * Part A (visits by wilaya) hinges on one unmeasured fact: what does
 * Cloudflare's "Add visitor location headers" Managed Transform actually
 * resolve for ALGERIAN networks — does `cf-region-code` carry the ISO
 * 3166-2:DZ wilaya number ("16"), some other vocabulary, or nothing at all
 * on the carrier CGNAT pools most visitors sit behind? The docs give the
 * header list and an example of "TX"; they do not state the standard, and
 * nobody publishes DZ resolution rates. So before any schema change, this
 * module OBSERVES: for each Cloudflare-trusted beacon request it increments
 * one counter row with what the geo headers said.
 *
 * WHAT IS RECORDED, PRECISELY — and what is not. The country code, the
 * region code, the region name, and PRESENCE booleans for city, postal,
 * lat/lon and timezone. Never the IP (this platform stores no visitor IP
 * anywhere), never the city/postal/coordinate VALUES — the feature under
 * evaluation would only ever store a 58-value wilaya code, so measuring at
 * finer grain than the decision needs would be collecting data for its own
 * sake. Everything lands in ONE `ProductSetting` row per tenant
 * (`website-builder` / `geoProbe`) as bounded counters, readable over the
 * database, because this machine has no Render log access. The row is the
 * measurement; it gets deleted when Part A's source decision is made.
 *
 * TEMPORARY BY INTENT: when the A-vs-B decision lands, this module and its
 * call site go. NEXT_STEPS §GEO.0 carries the sunset note.
 *
 * NEVER ON THE CUSTOMER'S PATH. The caller fires it AFTER the visit's own
 * transaction returned (the `dispatchTrackingEvent` pattern): it opens its
 * own tenant binding, so a probe failure can neither roll back nor slow the
 * beacon, and every error stops at one log line. The read-merge-write can
 * lose an increment under concurrency; at beacon volume that is noise, and
 * a lossy counter is the right price for not serialising a probe.
 * ========================================================================== */

export const GEO_PROBE_PRODUCT = "website-builder";
export const GEO_PROBE_KEY = "geoProbe";

/** Distinct (country|region-code|region) combinations kept per tenant. A bot
 * flood inventing header junk lands in `overflow` instead of growing the row. */
export const GEO_PROBE_MAX_KEYS = 200;

const VALUE_MAX = 40;

/** A header value, bounded and stripped to something a counter key can hold.
 * `_` replaces anything outside a conservative charset so a hostile header
 * cannot smuggle the "|" separator or unprintable bytes into the key. */
function bounded(value: string | null): string | null {
  if (!value) return null;
  const clean = value.trim().slice(0, VALUE_MAX).replace(/[^\p{L}\p{N} .,'-]/gu, "_");
  return clean.length > 0 ? clean : null;
}

export interface GeoHeaderSnapshot {
  /** cf-ipcountry — "DZ", "XX" for unknown, "T1" for Tor. */
  readonly country: string | null;
  /** cf-region-code — the field Part A would store, if it speaks ISO. */
  readonly regionCode: string | null;
  /** cf-region — the human name, kept to interpret regionCode. */
  readonly region: string | null;
  readonly hasCity: boolean;
  readonly hasPostal: boolean;
  readonly hasLatLon: boolean;
  readonly hasTimezone: boolean;
}

/** Pure: what the geo headers said, bounded, values-that-matter only. */
export function snapshotGeoHeaders(req: HeaderBag): GeoHeaderSnapshot {
  const h = (name: string) => req.headers.get(name);
  return {
    country: bounded(h("cf-ipcountry")),
    regionCode: bounded(h("cf-region-code")),
    region: bounded(h("cf-region")),
    hasCity: Boolean(h("cf-ipcity")),
    hasPostal: Boolean(h("cf-postal-code")),
    hasLatLon: Boolean(h("cf-iplatitude")) && Boolean(h("cf-iplongitude")),
    hasTimezone: Boolean(h("cf-timezone")),
  };
}

/** The counter key: one line per distinct answer the edge gave. */
export function probeKey(snap: GeoHeaderSnapshot): string {
  return `${snap.country ?? "-"}|${snap.regionCode ?? "-"}|${snap.region ?? "-"}`;
}

interface ProbeValue {
  total: number;
  overflow: number;
  counts: Record<string, number>;
  presence: { city: number; postal: number; latlon: number; timezone: number };
  firstAt: string;
  lastAt: string;
}

/** Merge one observation into the stored value. Exported pure for the suite. */
export function mergeProbe(stored: unknown, snap: GeoHeaderSnapshot, nowIso: string): ProbeValue {
  const base: ProbeValue =
    stored && typeof stored === "object"
      ? {
          total: Number((stored as ProbeValue).total) || 0,
          overflow: Number((stored as ProbeValue).overflow) || 0,
          counts: { ...((stored as ProbeValue).counts ?? {}) },
          presence: {
            city: Number((stored as ProbeValue).presence?.city) || 0,
            postal: Number((stored as ProbeValue).presence?.postal) || 0,
            latlon: Number((stored as ProbeValue).presence?.latlon) || 0,
            timezone: Number((stored as ProbeValue).presence?.timezone) || 0,
          },
          firstAt: String((stored as ProbeValue).firstAt ?? nowIso),
          lastAt: nowIso,
        }
      : { total: 0, overflow: 0, counts: {}, presence: { city: 0, postal: 0, latlon: 0, timezone: 0 }, firstAt: nowIso, lastAt: nowIso };

  base.total += 1;
  const key = probeKey(snap);
  if (key in base.counts) base.counts[key] = (base.counts[key] ?? 0) + 1;
  else if (Object.keys(base.counts).length < GEO_PROBE_MAX_KEYS) base.counts[key] = 1;
  else base.overflow += 1;

  if (snap.hasCity) base.presence.city += 1;
  if (snap.hasPostal) base.presence.postal += 1;
  if (snap.hasLatLon) base.presence.latlon += 1;
  if (snap.hasTimezone) base.presence.timezone += 1;
  return base;
}

/**
 * Fire-and-forget: observe this request's geo headers onto the tenant's
 * probe row. Records ONLY Cloudflare-attested requests — the same trust the
 * rate limiter uses — so a curl inventing `cf-ipcountry` against a
 * non-proxied host cannot pollute the measurement.
 */
export function recordGeoProbe(tenantId: string, req: HeaderBag): void {
  void (async () => {
    try {
      const identity = resolveClientIdentity(req);
      if (identity.source !== "cloudflare") return;
      const snap = snapshotGeoHeaders(req);
      const nowIso = new Date().toISOString();
      await withTenant(tenantId, async (db) => {
        const row = await (db as any).productSetting.findUnique({
          where: { tenantId_product_key: { tenantId, product: GEO_PROBE_PRODUCT, key: GEO_PROBE_KEY } },
          select: { value: true },
        });
        const merged = mergeProbe(row?.value, snap, nowIso);
        await (db as any).productSetting.upsert({
          where: { tenantId_product_key: { tenantId, product: GEO_PROBE_PRODUCT, key: GEO_PROBE_KEY } },
          create: { tenantId, product: GEO_PROBE_PRODUCT, key: GEO_PROBE_KEY, value: merged as never },
          update: { value: merged as never },
        });
      });
    } catch (error) {
      console.error("[geo-probe] observation failed", error);
    }
  })();
}
