/* =============================================================================
 * WM.1 — joining order counts to the wilaya map's vocabulary.
 *
 * The join is EXACT-NAME ON PURPOSE. `SalesOrder.wilaya` is a snapshot of
 * `Wilaya.name` taken by the one checkout route that writes orders — the
 * customer picks from a dropdown fed by the same reference table, so today
 * every stored value matches a reference name byte for byte (verified on
 * production data). No fuzzy matching: a name that stops matching is a signal
 * that something upstream changed, and it surfaces here as an `unmatched`
 * bucket the screen prints honestly instead of guessing a shape for it.
 *
 * PURE, no `t()`, no database — the caller passes the grouped counts and the
 * reference rows it already read. Testable without a server, the same rule as
 * `traffic-triage.ts`.
 * ========================================================================== */

export interface WilayaOrderGroup {
  /** The snapshot name as stored on the order. */
  readonly wilaya: string;
  readonly count: number;
}

export interface WilayaRefRow {
  /** "01".."58" — the platform's reference vocabulary. */
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
}

export interface WilayaMapRow {
  readonly code: string;
  /** Arabic name on an Arabic console when the reference carries one. */
  readonly label: string;
  readonly count: number;
  /** Share of ALL orders in the window, 0-100, rounded. */
  readonly sharePercent: number;
}

export interface WilayaMapData {
  /** Matched wilayas with at least one order, largest first; ties break on
   * code so the order is stable across renders. */
  readonly rows: readonly WilayaMapRow[];
  /** count per code, for the map fill. */
  readonly byCode: ReadonlyMap<string, number>;
  readonly max: number;
  readonly total: number;
  /** Order names that matched NO reference row — impossible via today's
   * checkout, printed rather than dropped if it ever happens. */
  readonly unmatched: readonly WilayaOrderGroup[];
}

export function buildWilayaMapData(
  groups: readonly WilayaOrderGroup[],
  ref: readonly WilayaRefRow[],
  locale: string,
): WilayaMapData {
  const byName = new Map(ref.map((r) => [r.name, r]));
  const total = groups.reduce((n, g) => n + g.count, 0);

  const byCode = new Map<string, number>();
  const unmatched: WilayaOrderGroup[] = [];
  for (const g of groups) {
    const row = byName.get(g.wilaya);
    if (!row) {
      unmatched.push(g);
      continue;
    }
    // Two snapshots can share a code only if the reference were ever to hold
    // duplicate names; summing is the safe behaviour either way.
    byCode.set(row.code, (byCode.get(row.code) ?? 0) + g.count);
  }

  const rows: WilayaMapRow[] = [...byCode.entries()]
    .map(([code, count]) => {
      const r = ref.find((x) => x.code === code)!;
      return {
        code,
        label: locale === "ar" && r.nameAr ? r.nameAr : r.name,
        count,
        sharePercent: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return {
    rows,
    byCode,
    max: rows.length > 0 ? rows[0]!.count : 0,
    total,
    unmatched,
  };
}

/**
 * The fill for one wilaya: a single-hue sequential ramp, darker = more.
 *
 * DELIBERATELY NOT THE FOUR-TIER SCALE. An order count is a quantity, not a
 * judgement — there is no "bad" number of orders in Adrar — so the map speaks
 * a different visual language from every severity surface on the page: one
 * hue whose strength tracks the count. Zero is not the bottom of the ramp,
 * it is OFF the ramp (`null`, rendered as the sunken surface), so "no orders"
 * can never be misread as "very few".
 *
 * Linear in the count, floored at 22% so one order is clearly ON the ramp.
 * Returns the mix percentage; the component owns the CSS.
 */
export function rampStrength(count: number, max: number): number | null {
  if (count <= 0 || max <= 0) return null;
  return Math.round(22 + 68 * (count / max));
}
