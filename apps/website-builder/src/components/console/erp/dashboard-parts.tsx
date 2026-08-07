import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { toneVars } from "@landingos/ui";

import { cn } from "@/lib/utils";
import * as s from "@/components/console/ui/styles";

/* =============================================================================
 * The dashboard's parts — PM.1.
 *
 * NO DIRECTIVE. Pure renders over props, like `ui/primitives.tsx`, so the
 * overview stays a server component: every figure on this screen is a database
 * answer and none of it is interactive, so shipping a client bundle to draw it
 * would buy nothing and cost the first paint.
 *
 * NO `t()` ANYWHERE. Every string arrives as a prop, which is the rule that
 * stops a component becoming the one place an untranslated literal lives.
 *
 * NO CHART LIBRARY, and that is a decision rather than an omission. `recharts`
 * is installed, and it is a client component that mounts, measures and re-renders
 * to draw fourteen rectangles. Fourteen rectangles are fourteen `<div>`s with a
 * percentage height: they render on the server, they cost nothing to hydrate,
 * they inherit the theme through the same tokens everything else uses, and they
 * are correct before JavaScript — which is the property every other read surface
 * in this console already has.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * The period selector
 * -------------------------------------------------------------------------- */

/**
 * A segmented control made of links.
 *
 * Links, not buttons: the period belongs in the URL so it can be bookmarked,
 * shared with a colleague and read back by the server — the same reasoning the
 * pager and the sortable headers were built with.
 */
export function PeriodTabs({
  basePath,
  active,
  options,
  label,
}: {
  readonly basePath: string;
  readonly active: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly label: string;
}) {
  return (
    <nav
      aria-label={label}
      data-testid="erp-dashboard-period"
      className="inline-flex items-center rounded-md border border-border bg-surface-subtle p-0.5"
    >
      {options.map((o) => {
        const current = o.value === active;
        return (
          <Link
            key={o.value}
            href={`${basePath}?range=${o.value}`}
            data-period={o.value}
            data-active={current ? "true" : undefined}
            aria-current={current ? "page" : undefined}
            className={cn(
              "tap rounded-[calc(var(--radius)-4px)] px-3 py-1.5 text-xs font-medium",
              "transition-colors duration-(--duration-fast)",
              current
                ? "bg-surface-raised text-foreground shadow-e1"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* -----------------------------------------------------------------------------
 * A headline figure with its comparison
 * -------------------------------------------------------------------------- */

/**
 * One KPI: what it is now, and what that is against the period before.
 *
 * THE DELTA IS THE POINT. A confirmation rate of 62% is a number; "62%, down
 * 6.2 points on the previous 7 days" is a decision about who to talk to this
 * afternoon. Which is why the comparison is not optional decoration here — a
 * tile with no basis for comparison says so in words (`noComparison`) rather
 * than showing a green 0%, because "unchanged" and "nothing to compare" are
 * different facts and only one of them is reassuring.
 *
 * `riseIsGood` is carried per figure, never inferred from the sign. A climbing
 * return rate with a green arrow beside it is worse than no arrow at all.
 */
export function KpiTile({
  id,
  label,
  value,
  suffix,
  sub,
  subId,
  delta,
  deltaKind,
  riseIsGood,
  comparison,
  noComparison,
  href,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** `%` for a rate; the currency is already inside a money value. */
  readonly suffix?: string;
  /**
   * The arithmetic behind a rate — "412 of 664".
   *
   * A percentage with no denominator beside it is a figure nobody can
   * sanity-check, and the screen this replaced carried the confirmation rate as
   * a sub-line under the confirmed count for exactly that reason. The rate is a
   * first-class tile now; it keeps its arithmetic.
   */
  readonly sub?: string;
  /** `data-sub`, which the analytics contract suite reads. */
  readonly subId?: string;
  readonly delta: number | null;
  readonly deltaKind: "points" | "percent";
  readonly riseIsGood: boolean;
  /** "vs the previous 7 days" */
  readonly comparison: string;
  readonly noComparison: string;
  readonly href?: string;
}) {
  const flat = delta !== null && Math.abs(delta) < 0.05;
  const good = delta === null || flat ? null : delta > 0 === riseIsGood;
  const Icon = delta === null || flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;

  const body = (
    <>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className="mt-1.5 flex items-baseline gap-0.5 text-2xl/none font-semibold tracking-tight tabular-nums"
        dir="ltr"
      >
        {value}
        {suffix && <span className="text-base font-medium text-muted-foreground">{suffix}</span>}
      </span>
      {sub && (
        <span data-sub={subId} className="mt-1 block text-2xs text-muted-foreground" dir="ltr">
          {sub}
        </span>
      )}
      <span className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs">
        {delta === null ? (
          <span className="text-muted-foreground">{noComparison}</span>
        ) : (
          <>
            <span
              data-delta={id}
              data-direction={flat ? "flat" : delta > 0 ? "up" : "down"}
              className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-semibold tabular-nums"
              style={
                good === null
                  ? toneVars("neutral")
                  : good
                    ? toneVars("success")
                    : toneVars("danger")
              }
              dir="ltr"
            >
              <Icon aria-hidden="true" className="size-3" />
              {Math.abs(delta).toFixed(1)}
              {deltaKind === "percent" ? "%" : " pts"}
            </span>
            <span className="text-muted-foreground">{comparison}</span>
          </>
        )}
      </span>
    </>
  );

  const shell = cn(
    s.surface,
    "p-4 transition-colors duration-(--duration-fast)",
    href && "hover:border-muted-foreground/30 hover:bg-surface-hover",
  );

  /* `data-tile` as well as `data-kpi`, and it is not redundant: the contract
     suite has asserted `data-tile="customers"` is present for a manager and
     absent for an agent since Phase 6.1, and that assertion is a D-05.1
     BOUNDARY rather than a fact about markup. A redesign that renamed the hook
     would have quietly discharged the test that proves an agent is not shown a
     company-wide customer count. */
  return href ? (
    <Link href={href} data-kpi={id} data-tile={id} className={shell}>
      {body}
    </Link>
  ) : (
    <div data-kpi={id} data-tile={id} className={shell}>
      {body}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * What needs a person
 * -------------------------------------------------------------------------- */

/**
 * One thing that is wrong, and the place it gets fixed.
 *
 * The card is the LINK, not a card containing a link: the whole target is the
 * hit area, which on a warehouse tablet is the difference between one tap and
 * three.
 *
 * A TINTED EDGE ON A NORMAL SURFACE, not a fully tinted card. Six saturated
 * panels in a row is a wall of alarm where nothing outranks anything, and the
 * body text on a danger tint has to be danger-coloured to stay legible — so the
 * hint ends up shouting as loudly as the count. The edge carries the severity,
 * the figure carries the colour, and the sentence stays readable.
 */
export function AlertCard({
  id,
  count,
  label,
  hint,
  href,
  severity,
  icon,
  testId,
  ...rest
}: {
  readonly id: string;
  readonly count: number;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
  readonly severity: "danger" | "warning" | "info";
  readonly icon: ReactNode;
  readonly testId?: string;
} & Record<`data-${string}`, string | number | undefined>) {
  const fg = `var(--${severity}-fg)`;
  return (
    <Link
      href={href}
      data-testid={testId}
      data-alert={id}
      data-count={count}
      data-severity={severity}
      {...rest}
      style={{ borderInlineStartColor: fg }}
      className={cn(
        "tap flex items-start gap-3 rounded-lg border border-s-[3px] border-border bg-surface-raised p-3",
        "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: fg }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-lg/none font-semibold tabular-nums" style={{ color: fg }} dir="ltr">
            {count}
          </span>
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
        </span>
        <span className="mt-1 block text-2xs text-muted-foreground">{hint}</span>
      </span>
    </Link>
  );
}

/* -----------------------------------------------------------------------------
 * The trend
 * -------------------------------------------------------------------------- */

export interface TrendBar {
  readonly day: string;
  readonly label: string;
  readonly orders: number;
  readonly confirmed: number;
}

/**
 * Orders per day, with the confirmed share filled in.
 *
 * ONE STACK, NOT TWO SERIES. Two bars side by side asks the reader to compare
 * two heights; one bar with its confirmed portion filled asks them to read a
 * proportion, which is the actual question — a day with 40 orders and 12
 * confirmations is a bad day whatever the neighbouring day's height was.
 *
 * A screen reader gets the table, not the bars: the same numbers, marked up as
 * what they are, at no cost to anybody who can see the shape.
 */
export function TrendChart({
  bars,
  labels,
  emptyLabel,
}: {
  readonly bars: readonly TrendBar[];
  readonly labels: {
    readonly caption: string;
    readonly day: string;
    readonly orders: string;
    readonly confirmed: string;
  };
  readonly emptyLabel: string;
}) {
  const max = bars.reduce((m, b) => Math.max(m, b.orders), 0);

  if (!max) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: "var(--success-fg)" }}
          />
          {labels.confirmed}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-muted-foreground/35" />
          {labels.orders}
        </span>
      </div>

      <div aria-hidden="true" className="flex h-36 items-end gap-[3px]" data-testid="erp-trend">
        {bars.map((b) => {
          const height = Math.max(2, Math.round((b.orders / max) * 100));
          const share = b.orders ? Math.round((b.confirmed / b.orders) * 100) : 0;
          return (
            <div
              key={b.day}
              data-day={b.day}
              data-orders={b.orders}
              data-confirmed={b.confirmed}
              // A native tooltip is the right weight here: it needs no state, no
              // portal and no bundle, and the same numbers are in the table
              // below for anybody it does not reach.
              title={`${b.label} · ${labels.orders}: ${b.orders} · ${labels.confirmed}: ${b.confirmed}`}
              className="group relative flex h-full flex-1 items-end"
            >
              <div
                style={{ height: `${height}%` }}
                className={cn(
                  "relative w-full overflow-hidden rounded-[3px] bg-muted-foreground/25",
                  "transition-colors duration-(--duration-fast) group-hover:bg-muted-foreground/40",
                )}
              >
                <div
                  style={{
                    height: `${share}%`,
                    backgroundColor: "color-mix(in oklab, var(--success-fg) 85%, transparent)",
                  }}
                  className="absolute inset-x-0 bottom-0"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        aria-hidden="true"
        className="mt-2 flex justify-between text-2xs text-muted-foreground"
        dir="ltr"
      >
        <span>{bars[0]?.label}</span>
        {bars.length > 2 && <span>{bars[Math.floor(bars.length / 2)]?.label}</span>}
        <span>{bars[bars.length - 1]?.label}</span>
      </div>

      <table className="sr-only">
        <caption>{labels.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.day}</th>
            <th scope="col">{labels.orders}</th>
            <th scope="col">{labels.confirmed}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.day}>
              <th scope="row">{b.label}</th>
              <td>{b.orders}</td>
              <td>{b.confirmed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * A ranked list
 * -------------------------------------------------------------------------- */

export interface RankRow {
  readonly key: string;
  readonly label: string;
  readonly sub?: string;
  /** The figure shown at the end of the row. */
  readonly value: string;
  /** 0–100. The bar behind the row. */
  readonly share: number;
  readonly href?: string;
  /** Colours the bar — a rate that is bad should not be a long green bar. */
  readonly tone?: "primary" | "success" | "warning" | "danger";
}

/**
 * Six rows with a proportional bar behind each — an agent roster, a carrier
 * comparison, the products that are moving.
 *
 * A BAR RATHER THAN A TABLE, and the reason is what these are read for. Nobody
 * reads a league table to learn that Karim handled 47 orders; they read it to
 * see who is carrying the queue and who is not, which is a comparison of
 * lengths and not of digits. The digits are still there for the one time
 * somebody needs the exact figure.
 */
export function RankList({
  rows,
  emptyLabel,
  testId,
}: {
  readonly rows: readonly RankRow[];
  readonly emptyLabel: string;
  readonly testId?: string;
}) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  /* `color-mix` in an inline style rather than a Tailwind opacity modifier on a
     custom property. The rule Phase UI added to this project's method is that an
     arbitrary value carrying an operator has to be verified in the running page,
     because it compiles, appears in the class list and can still emit no CSS —
     and a bar that silently has no fill is exactly the failure that rule was
     written about. This cannot fail that way. */
  const tint: Record<NonNullable<RankRow["tone"]>, string> = {
    primary: "color-mix(in oklab, var(--primary) 14%, transparent)",
    success: "color-mix(in oklab, var(--success-fg) 16%, transparent)",
    warning: "color-mix(in oklab, var(--warning-fg) 20%, transparent)",
    danger: "color-mix(in oklab, var(--danger-fg) 16%, transparent)",
  };

  return (
    <ul className="space-y-1" data-testid={testId}>
      {rows.map((r) => {
        const inner = (
          <>
            <span
              aria-hidden="true"
              style={{
                inlineSize: `${Math.max(2, Math.min(100, r.share))}%`,
                backgroundColor: tint[r.tone ?? "primary"],
              }}
              className="absolute inset-y-0 start-0 rounded-md"
            />
            <span className="relative min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{r.label}</span>
              {r.sub && <span className="block truncate text-2xs text-muted-foreground">{r.sub}</span>}
            </span>
            <span
              className="relative shrink-0 text-sm font-medium tabular-nums text-foreground"
              dir="ltr"
            >
              {r.value}
            </span>
          </>
        );

        const shell =
          "relative flex items-center gap-3 overflow-hidden rounded-md px-2.5 py-2 transition-colors duration-(--duration-fast)";

        return (
          <li key={r.key} data-rank={r.key}>
            {r.href ? (
              <Link href={r.href} className={cn(shell, "tap hover:bg-surface-hover")}>
                {inner}
              </Link>
            ) : (
              <div className={shell}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
