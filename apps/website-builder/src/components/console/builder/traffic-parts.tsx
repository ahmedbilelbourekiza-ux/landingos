import type { ReactNode } from "react";

import { toneVars, type StatusTone } from "@landingos/ui";

import { cn } from "@/lib/utils";
import * as s from "@/components/console/ui/styles";
import { WILAYA_MAP_VIEWBOX, WILAYA_SHAPES } from "@/lib/builder/algeria-wilaya-map";
import { rampStrength } from "@/lib/builder/wilaya-map-data";

/* =============================================================================
 * TR.1 / TR.2 — the Traffic screen's own visual parts.
 *
 * NO DIRECTIVE, and no `t()`. Same two rules `dashboard-parts.tsx` states and
 * for the same two reasons: the Traffic screen is a server component and every
 * figure on it is a database answer, so shipping a client bundle to draw it
 * would cost the first paint and buy nothing; and a component that translates
 * its own strings becomes the one place an untranslated literal hides.
 *
 * NO CHART LIBRARY. `recharts` is installed and unused, on the decision
 * recorded in `dashboard-parts.tsx`: bars here are `<div>`s with a percentage
 * inline size and the donut is one `<svg>` with stroke-dasharray arcs. They
 * render on the server, cost nothing to hydrate, inherit the theme through the
 * same tokens as everything else, and are correct before JavaScript.
 *
 * LOGICAL PROPERTIES ONLY. Arabic is this platform's default locale and the
 * console renders RTL by default, so bars grow along `inlineSize` and never
 * from `left`. Figures still carry `dir="ltr"`, because a number is read
 * left-to-right on an Arabic page too. The donut is direction-neutral.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * A verdict, as a pill
 * -------------------------------------------------------------------------- */

/**
 * One word about the state of something, in its tone's colours.
 *
 * The whole point of the redesign is that a merchant should not have to read
 * five numbers to find out whether a page is in trouble. This is where that
 * answer lives, so it is deliberately the only element on a page card that
 * carries a saturated colour.
 */
export function HealthChip({
  label,
  tone,
  icon,
  testId,
  id,
}: {
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon?: ReactNode;
  readonly testId?: string;
  readonly id?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-health={id}
      data-tone={tone}
      style={toneVars(tone)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold"
    >
      {icon}
      {label}
    </span>
  );
}

/* -----------------------------------------------------------------------------
 * The funnel
 * -------------------------------------------------------------------------- */

export interface FunnelRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** Pre-formatted for the locale — this component does no number formatting. */
  readonly display: string;
  /** 0-100, the bar's inline size. Always a share of views. */
  readonly barShare: number;
  /** "of 34 who saw the form", already assembled and translated. Null at the
   * top of the funnel. */
  readonly rateLabel: string | null;
  /** The step's share of the previous stage, 0-1 (may exceed 1 — clamped for
   * display), or null when unmeasurable. */
  readonly rate: number | null;
  readonly tone: StatusTone;
  readonly isCliff: boolean;
}

/** A non-zero stage is never narrower than this, so "one person did this"
 * and "nobody did this" cannot render identically. */
const FUNNEL_MIN_SHARE = 6;

/**
 * Five stages as a TAPERING shape: every bar is centred, so the silhouette
 * narrows from the top like the funnel it is, and each bar is coloured by the
 * share of the previous stage it keeps, on the console's four-tier scale.
 *
 * ONE COLOUR PER TIER, NOT ONE COLOUR FOR EVERYTHING. The screen this
 * replaced drew every stage in the same 22% tint of the brand crimson, so the
 * shape was visible and the DIAGNOSIS was not. Red, orange, blue, green now
 * say which step is the problem before the numbers are read.
 *
 * THE CLIFF IS NAMED, NOT JUST COLOURED. Colour ranks; it does not explain.
 * The steepest fall gets a word beside it, because "biggest drop" is the
 * sentence the merchant came to the screen for.
 *
 * A zero stage keeps a hairline so the shape reads as "empty here" rather
 * than as a row that failed to render.
 */
export function Funnel({
  rows,
  cliffLabel,
  testId,
}: {
  readonly rows: readonly FunnelRow[];
  /** "biggest drop", translated by the caller. */
  readonly cliffLabel: string;
  readonly testId?: string;
}) {
  return (
    <ol className="space-y-2.5" data-testid={testId}>
      {rows.map((row) => {
        const fg = `var(--${row.tone}-fg)`;
        const neutral = row.tone === "neutral";
        const percent = row.rate === null ? null : Math.min(100, Math.round(row.rate * 100));
        const width = row.count > 0 ? Math.max(row.barShare, FUNNEL_MIN_SHARE) : 2;
        return (
          <li
            key={row.key}
            data-step={row.key}
            data-tone={row.tone}
            data-cliff={row.isCliff ? "true" : undefined}
            className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-x-3 gap-y-1"
          >
            <span className="truncate text-xs text-muted-foreground">{row.label}</span>

            {/* The track is full width; the bar is CENTRED inside it, which is
                what turns five bars into a funnel silhouette. */}
            <span className="block h-6">
              <span
                aria-hidden="true"
                className={cn(
                  "block h-full rounded-sm",
                  row.count === 0 && "border border-dashed border-border",
                )}
                style={{
                  inlineSize: `${width}%`,
                  marginInline: "auto",
                  backgroundColor:
                    row.count === 0
                      ? "transparent"
                      : neutral
                        ? "color-mix(in oklab, var(--foreground) 14%, transparent)"
                        : `color-mix(in oklab, ${fg} 34%, transparent)`,
                }}
              />
            </span>

            <span
              className="text-sm font-semibold tabular-nums"
              dir="ltr"
              style={{ color: neutral ? undefined : fg }}
            >
              {row.display}
            </span>

            {/* The second line, under the bar: the share of the previous stage
                with its denominator, and the cliff word. */}
            {(percent !== null || row.isCliff) && (
              <span className="col-start-2 -mt-0.5 flex flex-wrap items-center justify-center gap-x-2 text-2xs text-muted-foreground">
                {percent !== null && (
                  <span dir="ltr">
                    <span className="font-semibold tabular-nums" style={{ color: fg }}>
                      {percent}%
                    </span>{" "}
                    {row.rateLabel}
                  </span>
                )}
                {row.isCliff && (
                  <span
                    className="inline-flex items-center rounded px-1 py-px font-semibold"
                    style={toneVars(row.tone)}
                  >
                    {cliffLabel}
                  </span>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* -----------------------------------------------------------------------------
 * The donut
 * -------------------------------------------------------------------------- */

export interface DonutSegment {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Pre-formatted for the locale. */
  readonly display: string;
  /** A second, quieter figure beside the first — "3 orders · 1.1%". */
  readonly sub?: string;
  /** A CSS colour — the caller assigns the palette. */
  readonly colour: string;
}

/**
 * A ring of shares with the total in the middle and the legend underneath.
 *
 * ONE SVG, NO LIBRARY. Each segment is the same circle drawn again with a
 * `stroke-dasharray` of its own length, offset by everything before it. That
 * is the whole chart: it renders on the server, it scales with the box, and
 * it needs no JavaScript to be correct.
 *
 * THE LEGEND IS THE DATA, the ring is the shape. A screen reader gets the
 * list of labels with counts and percentages; the ring is `aria-hidden`
 * because it says nothing the list does not. The percentages are of the
 * TOTAL, and sum to 100 give or take rounding — a legend that summed to 103
 * because every share was rounded up would be the kind of number nobody can
 * sanity-check.
 */
export function DonutChart({
  segments,
  total,
  totalDisplay,
  totalLabel,
  emptyLabel,
  testId,
}: {
  readonly segments: readonly DonutSegment[];
  readonly total: number;
  readonly totalDisplay: string;
  /** "views" — what the number in the middle counts. */
  readonly totalLabel: string;
  readonly emptyLabel: string;
  readonly testId?: string;
}) {
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6" data-testid={testId}>
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="14" className="stroke-surface-sunken" />
          {total > 0 &&
            segments.map((seg) => {
              const len = (seg.value / total) * C;
              const el = (
                <circle
                  key={seg.key}
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  strokeWidth="14"
                  stroke={seg.colour}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                  data-segment={seg.key}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl/none font-semibold tabular-nums tracking-tight" dir="ltr">
            {totalDisplay}
          </span>
          <span className={cn(s.meta, "mt-1")}>{totalLabel}</span>
        </div>
      </div>

      {total === 0 ? (
        <p className={s.hint}>{emptyLabel}</p>
      ) : (
        <ul className="w-full space-y-1.5 text-sm">
          {segments.map((seg) => {
            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
            return (
              <li key={seg.key} className="flex items-center gap-2" data-legend={seg.key}>
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: seg.colour }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {seg.label}
                  {seg.sub && <span className={cn(s.meta, "ms-2")}>{seg.sub}</span>}
                </span>
                <span className="tabular-nums text-muted-foreground" dir="ltr">
                  {seg.display}
                </span>
                <span className="w-10 text-end font-medium tabular-nums" dir="ltr">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * The wilaya map
 * -------------------------------------------------------------------------- */

/**
 * Algeria, coloured by order count.
 *
 * ONE SVG FROM A VENDORED ASSET — real OpenStreetMap boundaries extracted
 * once by `scripts/build-wilaya-map.mjs`, never fetched at runtime, never
 * approximated. 68 shapes because OSM already reflects the 2026 reform;
 * each post-reform shape joins the data through its parent's code
 * (`displayCode`), so the map speaks the same 58-wilaya vocabulary as the
 * checkout that produced every order on it.
 *
 * A SEQUENTIAL RAMP, NOT THE SEVERITY SCALE. A count is a quantity, not a
 * judgement, so this is the one surface on the page that does not speak
 * red-to-green: a single hue, darker meaning more. Zero is OFF the ramp —
 * the sunken surface, visibly not the lightest data colour — because "no
 * orders" and "one order" are different facts and must not blur.
 *
 * THE RANKED LIST IS THE DATA; the map is `aria-hidden` shape. A screen
 * reader loses nothing: every number on the map is in the list beside it.
 * Native `<title>` tooltips only — no JavaScript, correct before hydration
 * like every other chart on this screen.
 */
export function WilayaMap({
  byCode,
  max,
  titles,
  legendNone,
  legendScale,
  testId,
}: {
  /** Order count per 58-vocabulary code. */
  readonly byCode: ReadonlyMap<string, number>;
  readonly max: number;
  /** Pre-translated tooltip per code — "Adrar · 3 orders". */
  readonly titles: ReadonlyMap<string, string>;
  readonly legendNone: string;
  readonly legendScale: string;
  readonly testId?: string;
}) {
  return (
    <figure data-testid={testId} className="m-0">
      <svg
        viewBox={WILAYA_MAP_VIEWBOX}
        className="h-auto w-full"
        role="img"
        aria-hidden="true"
      >
        {WILAYA_SHAPES.map((shape) => {
          const count = byCode.get(shape.displayCode) ?? 0;
          const strength = rampStrength(count, max);
          const title = titles.get(shape.displayCode);
          return (
            <path
              key={shape.code}
              d={shape.d}
              data-wilaya={shape.code}
              data-display-code={shape.displayCode}
              data-count={count}
              stroke="var(--surface-raised)"
              strokeWidth="1"
              fill={
                strength === null
                  ? "color-mix(in oklab, var(--neutral-fg) 14%, var(--surface-raised))"
                  : `color-mix(in oklab, var(--chart-3) ${strength}%, var(--surface-raised))`
              }
            >
              {title && <title>{title}</title>}
            </path>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm border border-border"
            style={{ backgroundColor: "color-mix(in oklab, var(--neutral-fg) 14%, var(--surface-raised))" }}
          />
          {legendNone}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-16 rounded-sm"
            style={{
              background:
                "linear-gradient(to right, color-mix(in oklab, var(--chart-3) 22%, var(--surface-raised)), color-mix(in oklab, var(--chart-3) 90%, var(--surface-raised)))",
            }}
          />
          {legendScale}
        </span>
        {/* The ODbL credit for the boundary data — a legal name, never
            translated. Required by the licence of the vendored asset. */}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="ms-auto hover:text-foreground"
          dir="ltr"
        >
          © OpenStreetMap contributors
        </a>
      </figcaption>
    </figure>
  );
}

/* -----------------------------------------------------------------------------
 * One AI recommendation
 * -------------------------------------------------------------------------- */

/**
 * A finding, the number it stands on, and what to do about it.
 *
 * WHAT CHANGED AND WHY. These used to render as a bordered box whose only
 * emphasis was the section name in an `bg-accent` chip — which read as an
 * inline code tag, so the most valuable thing on the screen looked like
 * debug output. Three things fix that: the severity is carried on the
 * inline-start edge (the `AlertCard` pattern, so the console has one visual
 * language for "this matters"), the GROUNDING NUMBER is promoted to a
 * figure, and the section becomes an icon plus a word rather than a tag.
 *
 * THE NUMBER IS THE POINT. `metric` and `value` were fetched, validated
 * against the stored summary and then thrown away by the renderer. Grounding
 * guarantees `value` byte-equals the number in `inputSummary`, so it is the
 * one part of an AI answer that cannot be wrong — which makes it the right
 * thing to lead with.
 *
 * `dir="auto"` on the prose: stored recommendations written before TR.1 are
 * Arabic whatever the console locale is, and an Arabic sentence in an LTR
 * paragraph renders its punctuation in the wrong place. `auto` lets the
 * browser decide per string, which is correct for both the old rows and the
 * new ones.
 */
export function InsightCard({
  severity,
  sectionLabel,
  sectionIcon,
  finding,
  suggestion,
  value,
  metricLabel,
  testId,
}: {
  readonly severity: StatusTone;
  readonly sectionLabel: string;
  readonly sectionIcon: ReactNode;
  readonly finding: string;
  readonly suggestion: string;
  /** Pre-formatted for the locale. */
  readonly value: string;
  /** What the number counts, translated — or null for a metric with no label
   * in the vocabulary yet, in which case the figure stands alone. */
  readonly metricLabel: string | null;
  readonly testId?: string;
}) {
  const fg = `var(--${severity}-fg)`;
  return (
    <li
      data-testid={testId}
      data-severity={severity}
      style={{ borderInlineStartColor: fg }}
      className={cn(s.surface, "border-s-[3px] p-3")}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true" style={{ color: fg }} className="shrink-0">
          {sectionIcon}
        </span>
        <span className="text-xs font-semibold text-foreground">{sectionLabel}</span>
        <span className="ms-auto flex items-baseline gap-1.5" dir="ltr">
          <span className="text-lg/none font-semibold tabular-nums" style={{ color: fg }}>
            {value}
          </span>
          {metricLabel && (
            <span className="text-2xs text-muted-foreground">{metricLabel}</span>
          )}
        </span>
      </div>
      <p className="mt-2 text-sm text-foreground" dir="auto">
        {finding}
      </p>
      <p className={cn(s.hint, "mt-1")} dir="auto">
        {suggestion}
      </p>
    </li>
  );
}
