/* Relative, with the extension, like `ai-insight.ts` and every other lib
 * module the suite imports directly: `node --test` resolves no `@/` alias. */
import { validThresholds, type Thresholds } from "../console/benchmark.ts";

/* =============================================================================
 * TR.2 — the Traffic screen's tile catalogue and the merchant's preferences.
 *
 * "CONFIGURABLE" MEANS A FIXED CATALOGUE. Every tile a merchant can show has
 * code behind it — a query, a formatter, a test id the contract suite pins —
 * so the catalogue is a closed list and the preference is which of those to
 * hide. A preference that named an arbitrary metric would be a request for a
 * feature, not a setting.
 *
 * WHERE IT LIVES: one `ProductSetting` row, `(tenantId, "website-builder",
 * "trafficTiles")`. The ERP stores its own settings the same way, and the
 * reasoning in `lib/erp/settings.ts` transfers whole: keyed by tenant and
 * product so no company sees another's, no new table, no migration, and one
 * validated shape so a typo cannot become a setting. Tenant-level rather than
 * per page, because a tile is a store-wide figure and a merchant who hides
 * "impressions" means it everywhere.
 *
 * THRESHOLDS ARE THE MERCHANT'S, NEVER OURS. `benchmark.ts` explains why: a
 * cost per order has no meaning without the margin behind it, and this
 * platform does not know the margin. So a colourable tile ships GREY, and the
 * three cut points in `thresholds` are what turn it on. The direction (is a
 * higher figure better?) is fixed per metric here, not chosen by the merchant
 * — a cost is a cost, and a form that let someone declare "higher cost per
 * order is good" would only ever be used by mistake.
 *
 * PURE. Validation and the catalogue are testable without a server; the
 * database read/upsert lives in the route, following the ERP's split.
 * ========================================================================== */

/** Every tile the screen can render, in display order. */
export const TILE_KEYS = [
  // The KPI band.
  "views",
  "visitors",
  "orders",
  "conversion",
  // Meta ads performance.
  "adSpend",
  "adImpressions",
  "adCtr",
  "adCpc",
  "adCpm",
  "adLinkClicks",
  "adOrders",
  "adCostPerOrder",
] as const;

export type TileKey = (typeof TILE_KEYS)[number];

export function isTileKey(value: unknown): value is TileKey {
  return typeof value === "string" && (TILE_KEYS as readonly string[]).includes(value);
}

/**
 * The tiles a merchant may set cut points on, with the direction the scale
 * reads in. A metric absent here is a COUNT or a money total with no
 * "good" — spend, impressions, clicks, orders — and stays neutral for good.
 */
export const COLOURABLE: Readonly<Partial<Record<TileKey, { readonly higherIsBetter: boolean }>>> = {
  conversion: { higherIsBetter: true },
  adCtr: { higherIsBetter: true },
  adCpc: { higherIsBetter: false },
  adCpm: { higherIsBetter: false },
  adCostPerOrder: { higherIsBetter: false },
};

export function isColourable(key: TileKey): boolean {
  return key in COLOURABLE;
}

export interface TilePreferences {
  /** Tiles the merchant has switched off. */
  readonly hidden: readonly TileKey[];
  /** The merchant's own cut points, per colourable tile. */
  readonly thresholds: Readonly<Partial<Record<TileKey, Thresholds>>>;
}

export const DEFAULT_TILE_PREFERENCES: TilePreferences = { hidden: [], thresholds: {} };

export const TILES_PRODUCT = "website-builder";
export const TILES_KEY = "trafficTiles";

/** An upper bound on the stored shape, so a malformed row cannot grow. */
const MAX_HIDDEN = TILE_KEYS.length;

/**
 * Read a stored value defensively.
 *
 * The row is JSON with no schema at the database, so a hand-edited or
 * pre-vocabulary value must degrade to the defaults rather than throw inside
 * a server component. Unknown keys are DROPPED, not kept: a tile that no
 * longer exists cannot be hidden, and a threshold for a tile that is not
 * colourable would be stored but never read.
 */
export function parseTilePreferences(raw: unknown): TilePreferences {
  if (!raw || typeof raw !== "object") return DEFAULT_TILE_PREFERENCES;
  const obj = raw as { hidden?: unknown; thresholds?: unknown };

  const hidden: TileKey[] = [];
  if (Array.isArray(obj.hidden)) {
    for (const k of obj.hidden.slice(0, MAX_HIDDEN)) {
      if (isTileKey(k) && !hidden.includes(k)) hidden.push(k);
    }
  }

  const thresholds: Partial<Record<TileKey, Thresholds>> = {};
  if (obj.thresholds && typeof obj.thresholds === "object") {
    for (const [k, v] of Object.entries(obj.thresholds as Record<string, unknown>)) {
      if (!isTileKey(k) || !isColourable(k)) continue;
      const t = readThresholds(v);
      if (t && validThresholds(t, COLOURABLE[k]!.higherIsBetter)) thresholds[k] = t;
    }
  }

  return { hidden, thresholds };
}

function readThresholds(v: unknown): Thresholds | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const bad = Number(o.bad);
  const almostBad = Number(o.almostBad);
  const almostGood = Number(o.almostGood);
  if (![bad, almostBad, almostGood].every(Number.isFinite)) return null;
  return { bad, almostBad, almostGood };
}

/* -----------------------------------------------------------------------------
 * Validation of a WRITE
 * -------------------------------------------------------------------------- */

export interface TileValidation {
  readonly clean: TilePreferences | null;
  readonly errors: readonly string[];
}

/**
 * Validate a full preferences body. The whole batch is refused on the first
 * problem — the ERP settings rule: half-applying a rejected request is worse
 * than refusing it.
 *
 * Unlike the read path, unknown keys here are ERRORS, not silently dropped:
 * a client that sends a tile key this build does not know is out of date,
 * and it should learn that from a 422 rather than from a preference that
 * quietly did nothing.
 */
export function validateTilePreferences(body: unknown): TileValidation {
  const errors: string[] = [];
  if (!body || typeof body !== "object") return { clean: null, errors: ["body must be an object"] };
  const obj = body as { hidden?: unknown; thresholds?: unknown };

  const hidden: TileKey[] = [];
  if (obj.hidden !== undefined) {
    if (!Array.isArray(obj.hidden)) errors.push("hidden must be an array of tile keys");
    else {
      for (const k of obj.hidden) {
        if (!isTileKey(k)) errors.push(`unknown tile: ${String(k)}`);
        else if (!hidden.includes(k)) hidden.push(k);
      }
    }
  }

  const thresholds: Partial<Record<TileKey, Thresholds>> = {};
  if (obj.thresholds !== undefined) {
    if (!obj.thresholds || typeof obj.thresholds !== "object" || Array.isArray(obj.thresholds)) {
      errors.push("thresholds must be an object keyed by tile");
    } else {
      for (const [k, v] of Object.entries(obj.thresholds as Record<string, unknown>)) {
        if (!isTileKey(k)) { errors.push(`unknown tile: ${k}`); continue; }
        if (!isColourable(k)) { errors.push(`${k} has no benchmark direction and cannot be coloured`); continue; }
        // `null` clears a stored threshold — the way a merchant turns a colour
        // back off without an extra endpoint.
        if (v === null) continue;
        const t = readThresholds(v);
        if (!t) { errors.push(`${k}: bad, almostBad and almostGood must all be numbers`); continue; }
        const dir = COLOURABLE[k]!.higherIsBetter;
        if (!validThresholds(t, dir)) {
          errors.push(
            dir
              ? `${k}: cut points must rise (bad < almostBad < almostGood)`
              : `${k}: cut points must fall (bad > almostBad > almostGood)`,
          );
          continue;
        }
        thresholds[k] = t;
      }
    }
  }

  if (errors.length) return { clean: null, errors };
  return { clean: { hidden, thresholds }, errors: [] };
}

/**
 * Merge a validated write onto what is stored: `hidden` REPLACES (the form
 * sends the whole list), a threshold key sent as null CLEARS, and any
 * colourable tile the body did not mention keeps its stored cut points.
 */
export function mergeTilePreferences(
  stored: TilePreferences,
  clean: TilePreferences,
  clearedKeys: readonly TileKey[],
): TilePreferences {
  const thresholds: Partial<Record<TileKey, Thresholds>> = { ...stored.thresholds };
  for (const k of clearedKeys) delete thresholds[k];
  for (const [k, t] of Object.entries(clean.thresholds) as [TileKey, Thresholds][]) thresholds[k] = t;
  return { hidden: clean.hidden, thresholds };
}

/** The keys a body asked to clear — `thresholds: { adCpc: null }`. */
export function clearedThresholdKeys(body: unknown): TileKey[] {
  const obj = body as { thresholds?: unknown } | null;
  if (!obj || !obj.thresholds || typeof obj.thresholds !== "object") return [];
  return Object.entries(obj.thresholds as Record<string, unknown>)
    .filter(([k, v]) => v === null && isTileKey(k))
    .map(([k]) => k as TileKey);
}
