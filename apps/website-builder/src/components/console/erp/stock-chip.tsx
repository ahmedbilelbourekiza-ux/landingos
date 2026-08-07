import { toneVars } from "@landingos/ui";

import { cn } from "@/lib/utils";
import { stockLevel, STOCK_TONE, type StockSeverity } from "@/lib/erp/stock-level";

/* =============================================================================
 * A stock level, said once, the same way everywhere — PM.5.
 *
 * NO DIRECTIVE. Server screens (products, inventory, the order detail, the
 * dashboard) and one client panel (the variant editor) all render this, and the
 * only way both sides can import the same component is for it to carry neither
 * `server-only` nor `"use client"`. Same rule as `ui/primitives.tsx`.
 *
 * WHAT IT CLOSES. Before this, "is this running out" was answered in four
 * places and three different ways: the products grid set a `font-medium` on the
 * number and a `data-low` attribute nobody could see, the inventory screen
 * rendered a separate table of low rows with no marking on the rows themselves,
 * the order detail said nothing at all, and the variant editor showed a bare
 * input. An operator confirming an order had no way to know the thing they were
 * promising was gone.
 *
 * The severity vocabulary lives in `lib/erp/stock-level.ts` so that a count on
 * the dashboard, a chip on a row and a warning on an order cannot disagree
 * about what "critical" means.
 * ========================================================================== */

export interface StockLabels {
  readonly out: string;
  readonly critical: string;
  readonly low: string;
  readonly ok: string;
  readonly threshold: string;
}

export function StockChip({
  stock,
  threshold,
  labels,
  /** Show the severity word beside the figure. Off in a dense table column. */
  showLabel = true,
  /** Render nothing at all when the level is healthy — for a row that only
   *  wants to speak up when something is wrong. */
  onlyWhenAlert = false,
  className,
}: {
  readonly stock: number;
  readonly threshold: number;
  readonly labels: StockLabels;
  readonly showLabel?: boolean;
  readonly onlyWhenAlert?: boolean;
  readonly className?: string;
}) {
  const severity = stockLevel(stock, threshold);
  if (onlyWhenAlert && severity === "ok") return null;

  const word: Record<StockSeverity, string> = {
    out: labels.out,
    critical: labels.critical,
    low: labels.low,
    ok: labels.ok,
  };

  return (
    <span
      data-stock-severity={severity}
      data-stock={stock}
      // The threshold is the reason the chip is the colour it is. It belongs on
      // the element rather than in a column of its own — the number only means
      // something next to the limit it is being judged against.
      title={threshold > 0 ? `${labels.threshold}: ${threshold}` : undefined}
      // `neutral` rather than `success` when everything is fine: a green pill on
      // every healthy row makes the page a Christmas tree and the two rows that
      // matter disappear into it.
      style={toneVars(severity === "ok" ? "neutral" : STOCK_TONE[severity])}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        className,
      )}
      dir="ltr"
    >
      {stock}
      {showLabel && severity !== "ok" && (
        <span className="text-2xs font-semibold uppercase tracking-wide opacity-90">
          {word[severity]}
        </span>
      )}
    </span>
  );
}
