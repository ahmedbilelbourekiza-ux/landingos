import type { StatusTone } from "@landingos/ui";

/* Relative, with the extension, like `ai-insight.ts` and every other lib
 * module the suite imports directly: `node --test` resolves no `@/` alias. */
import { toneFor, type Thresholds } from "../console/benchmark.ts";

/* =============================================================================
 * TR.1 — the Traffic screen's judgement layer.
 *
 * THE PROBLEM THIS EXISTS FOR. The screen rendered every figure at the same
 * weight in the same colour, so "279 views, 0 orders" and "photos 216" were
 * typographically the same sentence. A merchant had to read every number and
 * do the arithmetic themselves to find out whether anything was wrong. This
 * module does that arithmetic once, deterministically, so the screen can lead
 * with the answer.
 *
 * PURE, AND NO `t()`. Every function here is arithmetic over numbers the
 * screen already has — no database, no locale, no JSX. It returns KINDS and
 * TONES, never sentences: the page maps a kind onto a literal i18n key (the
 * scanner cannot see `t(\`a.${x}\`)`, so the mapping has to be a switch over
 * literals in the component). That split is also what makes this file
 * testable without a server, the rule `order-abuse.ts` and `spend-math.ts`
 * already follow.
 *
 * NOTHING HERE INVENTS A METRIC. Every input is a number the page already
 * fetched. There is no session concept and no cart in this product, so there
 * is no bounce rate and no funnel stage beyond the five the page already
 * counts. A derivation that needed a number this platform does not record
 * would be a lie with a colour on it.
 *
 * NULL IS NOT ZERO, EVERYWHERE. `measured === 0` means behaviour tracking is
 * off or nothing flushed — it does NOT mean nobody saw the form. Every rate
 * below refuses a zero denominator and returns `null`, and every caller is
 * expected to render "not measured" rather than 0%.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * Floors
 * -------------------------------------------------------------------------- */

/**
 * Below this many views in the window, a page is not judged at all.
 *
 * A page with 3 views and 0 orders is not "failing"; it is untested. Colouring
 * it red would spend the merchant's attention on noise, and the alert band is
 * only worth reading if everything in it is worth acting on. Deliberately far
 * below `INSIGHT_MIN_VIEWS` (100): the AI needs a sample to reason over, a
 * human reading "0 of 40 reached the form" does not.
 */
export const TRIAGE_MIN_VIEWS = 25;

/** Below this share of measured views reaching the form, the page is failing
 * at its first job. Not tuned against a benchmark — no benchmark exists for
 * this product yet — but chosen so it fires on "most people never got there". */
export const FORM_REACH_DANGER = 0.25;
/** Between this and DANGER, it is worth a look rather than an alarm. */
export const FORM_REACH_WARNING = 0.5;

/**
 * TR.2 — the funnel's four bands, as the share of the PREVIOUS stage a step
 * keeps. Product thresholds, not an industry benchmark: no published figure
 * exists for "share of visitors who reach a COD order form", so these are the
 * points at which this product chooses to change colour. Below a fifth is
 * red, below half is orange, below four fifths is blue, and the rest is green.
 */
export const FUNNEL_THRESHOLDS: Thresholds = { bad: 0.2, almostBad: 0.5, almostGood: 0.8 };

/* -----------------------------------------------------------------------------
 * Rates that refuse a zero denominator
 * -------------------------------------------------------------------------- */

/**
 * `count / base`, or null when the question cannot be asked.
 *
 * The whole screen's honesty rests on this returning null rather than 0: a
 * page with behaviour tracking off has `measured === 0`, and "0% reached the
 * form" is a false statement about a page nobody measured.
 */
export function rate(count: number, base: number): number | null {
  if (!Number.isFinite(count) || !Number.isFinite(base) || base <= 0) return null;
  return count / base;
}

/* -----------------------------------------------------------------------------
 * The funnel, with severity
 * -------------------------------------------------------------------------- */

/**
 * One funnel step as the screen needs to draw it.
 *
 * `barShare` and `rate` are DIFFERENT NUMBERS and that is the point. The bar
 * is scaled to views so five bars are visually comparable; the rate is against
 * the step's own honest denominator, because "saw the form" is a share of
 * MEASURED views (behaviour-gated) while "started an order" is a share of all
 * views. Drawing one and quoting the other is what lets the screen show a
 * shape without lying about a proportion.
 */
export interface FunnelStep {
  readonly key: FunnelStepKey;
  readonly count: number;
  /** 0-100, for the bar's inline size. Always relative to views. */
  readonly barShare: number;
  /** TR.2 — the step's share of the PREVIOUS stage (the nearest earlier
   * stage with a non-zero count), or null at the top of the funnel. Can
   * exceed 1 in one honest case — an order placed faster than the draft
   * debounce has no draft before it — so a renderer clamps the percentage. */
  readonly rate: number | null;
  /** Which stage `rate` is against — the page prints it beside the bar.
   * `"measured"` for the form step: only measured views can have seen it. */
  readonly rateBase: FunnelStepKey | "measured" | null;
  /** The count `rate` divides by, so the label can print it. */
  readonly rateBaseCount: number | null;
  readonly tone: StatusTone;
  /** True for the single steepest measurable fall in the funnel. */
  readonly isCliff: boolean;
}

export type FunnelStepKey = "viewed" | "sawForm" | "drafts" | "phone" | "ordered";

export interface FunnelInput {
  readonly views: number;
  readonly orders: number;
  readonly draftsStarted: number;
  readonly draftsWithPhone: number;
  /** Null when the page has no measured views — the two behaviour-derived
   * steps are then omitted rather than rendered as zero. */
  readonly behavior: { readonly measured: number; readonly sawForm: number } | null;
}

/** A step's tone from the share of the previous stage it keeps, on the
 * console's four-tier scale. Neutral when unmeasurable — never green, because
 * "we did not measure" is not good news. */
function toneForRate(r: number | null): StatusTone {
  return toneFor(r, FUNNEL_THRESHOLDS, true) ?? "neutral";
}

/**
 * The five stages, each carrying its own severity and the one marked cliff.
 *
 * THE CLIFF IS THE HEADLINE. A merchant looking at five bars wants one
 * question answered — where do people leave? — and picking the steepest
 * measurable fall answers it deterministically, with no model and no
 * threshold to disagree about. Ties go to the EARLIEST step: fixing the first
 * wall is what changes everything after it.
 *
 * The behaviour steps drop out entirely when nothing was measured. The screen
 * then shows a three-step funnel and says tracking is off, which is honest;
 * showing a zero-height "saw the form" bar would read as "nobody did".
 */
export function buildFunnel(input: FunnelInput): FunnelStep[] {
  const { views, orders, draftsStarted, draftsWithPhone, behavior } = input;
  const barBase = Math.max(views, 1);

  /* TR.2 — each step is a share of the stage BEFORE it, which is what a
     funnel is read for. Two honesty rules on top of the literal definition:

     1. The form step divides by MEASURED views, not all views. Only an
        opted-in, successfully flushed view can have seen the form, so
        "34 of 266" would understate a rate the collector never had a chance
        to observe on the other six.

     2. When the previous stage is EMPTY, the step is measured against the
        nearest earlier stage that is not. A page with 266 views, no drafts
        and no orders would otherwise show "ordered: 0" in neutral grey —
        unjudgeable because nobody started — when the truthful reading is
        that 266 people arrived and none bought. */
  const chain: { key: FunnelStepKey; count: number; base: FunnelStepKey | "measured" | null; baseCount: number | null }[] = [];
  const push = (key: FunnelStepKey, count: number) => {
    let base: FunnelStepKey | "measured" | null = null;
    let baseCount: number | null = null;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const prev = chain[i]!;
      if (prev.count > 0) {
        base = prev.key;
        baseCount = prev.count;
        break;
      }
    }
    chain.push({ key, count, base, baseCount });
  };

  push("viewed", views);
  if (behavior) {
    chain.push({
      key: "sawForm",
      count: behavior.sawForm,
      base: "measured",
      baseCount: behavior.measured > 0 ? behavior.measured : null,
    });
  }
  push("drafts", draftsStarted);
  push("phone", draftsWithPhone);
  push("ordered", orders);

  const raw = chain.map((step) => ({
    ...step,
    rate: step.baseCount === null ? null : rate(step.count, step.baseCount),
  }));

  // The steepest measurable fall. Compared on RATE, not on absolute loss:
  // the biggest absolute drop is almost always the first step simply because
  // it starts from the largest number. Ties go to the EARLIEST step: fixing
  // the first wall is what changes everything after it.
  let cliffKey: FunnelStepKey | null = null;
  let worst = Number.POSITIVE_INFINITY;
  for (const step of raw) {
    if (step.rate === null) continue;
    if (step.rate < worst) {
      worst = step.rate;
      cliffKey = step.key;
    }
  }

  return raw.map((step) => ({
    key: step.key,
    count: step.count,
    barShare: Math.min(100, (step.count / barBase) * 100),
    rate: step.rate,
    rateBase: step.base,
    rateBaseCount: step.baseCount,
    tone: toneForRate(step.rate),
    isCliff: step.key === cliffKey,
  }));
}

/* -----------------------------------------------------------------------------
 * A page's health, in one word
 * -------------------------------------------------------------------------- */

export type PageHealth =
  /** Not enough traffic to say anything. */
  | "untested"
  /** Traffic arrives and orders follow. */
  | "selling"
  /** Orders exist but almost nobody who arrives buys. */
  | "thin"
  /** People start the form and stop. */
  | "stalling"
  /** Visitors never even reach the form. */
  | "unreached"
  /** Traffic, no orders, and nothing measured that explains why. */
  | "noOrders";

export interface PageHealthVerdict {
  readonly health: PageHealth;
  readonly tone: StatusTone;
}

/**
 * One verdict per page, decided in a fixed order so it never depends on which
 * rule was written first.
 *
 * The order is deliberately most-specific-first: "they never reached the form"
 * and "they reached it and stopped" are different problems with different
 * fixes, and collapsing both into "no orders" is what made the old screen
 * unreadable. `untested` comes first of all, because every rule below it is
 * meaningless on four views.
 */
export function pageHealth(input: FunnelInput & { readonly conversion: number | null }): PageHealthVerdict {
  const { views, orders, draftsStarted, behavior, conversion } = input;

  if (views < TRIAGE_MIN_VIEWS && orders === 0) return { health: "untested", tone: "neutral" };
  if (orders > 0) {
    // One order per hundred views is not a benchmark, it is the point where
    // the figure stops rounding to nothing on this product's typical volumes.
    if (conversion !== null && conversion >= 1) return { health: "selling", tone: "success" };
    return { health: "thin", tone: "info" };
  }

  const formReach = behavior ? rate(behavior.sawForm, behavior.measured) : null;
  if (formReach !== null && formReach < FORM_REACH_DANGER) {
    return { health: "unreached", tone: "danger" };
  }
  if (draftsStarted > 0) return { health: "stalling", tone: "warning" };
  return { health: "noOrders", tone: "danger" };
}

/* -----------------------------------------------------------------------------
 * The alert band
 * -------------------------------------------------------------------------- */

export type AlertKind =
  /** Visitors are not reaching the order form on a page. */
  | "formUnreached"
  /** Money was spent on ads and no attributed order came back. */
  | "spendNoOrders"
  /** Real traffic, zero orders, store-wide. */
  | "noOrders"
  /** A page has traffic but behaviour tracking is off, so nothing explains it. */
  | "trackingOff"
  /** A page has enough views for an analysis nobody has run. */
  | "analysisReady";

export interface TriageAlert {
  readonly kind: AlertKind;
  /** The figure the card leads with. Always a count of something real. */
  readonly count: number;
  readonly severity: "danger" | "warning" | "info";
  /** The page this is about, when it is about one. */
  readonly landingPageId: string | null;
  /** Numbers the page interpolates into the hint sentence. */
  readonly context: Readonly<Record<string, number>>;
}

export interface TriageInput {
  readonly totals: { readonly views: number; readonly orders: number };
  readonly pages: readonly {
    readonly landingPageId: string;
    readonly views: number;
    readonly orders: number;
    readonly behavior: { readonly measured: number; readonly sawForm: number } | null;
    readonly hasInsight: boolean;
  }[];
  /** Null unless an ad account is connected AND synced. */
  readonly spend: { readonly amount: number; readonly orders: number; readonly clicks: number } | null;
  readonly insightMinViews: number;
}

const SEVERITY_RANK: Record<TriageAlert["severity"], number> = { danger: 0, warning: 1, info: 2 };

/**
 * What needs a person, worst first — and nothing else.
 *
 * THE BAND IS ONLY USEFUL IF IT IS SHORT. Five cards is a second list to read,
 * which is the thing this redesign is removing; the caller takes the first
 * few. Sorted by severity, then by the size of the number, so the worst
 * problem on the busiest page leads.
 *
 * Every alert here is a statement about numbers the page already has. There is
 * deliberately no "your conversion is below average" — this product has no
 * benchmark to compare against, and inventing one would be the same failure as
 * inventing a metric.
 */
export function deriveAlerts(input: TriageInput): TriageAlert[] {
  const alerts: TriageAlert[] = [];

  for (const page of input.pages) {
    if (page.views < TRIAGE_MIN_VIEWS) continue;

    const formReach = page.behavior ? rate(page.behavior.sawForm, page.behavior.measured) : null;
    if (formReach !== null && formReach < FORM_REACH_WARNING && page.behavior) {
      alerts.push({
        kind: "formUnreached",
        count: page.behavior.sawForm,
        severity: formReach < FORM_REACH_DANGER ? "danger" : "warning",
        landingPageId: page.landingPageId,
        context: {
          measured: page.behavior.measured,
          // Rounded here rather than in the component: the sentence needs a
          // whole number and the rounding rule belongs with the arithmetic.
          percent: Math.round(formReach * 100),
        },
      });
    }

    // Tracking off is only worth saying on a page with enough traffic to
    // diagnose — otherwise it is a nag about a page nobody has visited.
    if (page.behavior === null) {
      alerts.push({
        kind: "trackingOff",
        count: page.views,
        severity: "info",
        landingPageId: page.landingPageId,
        context: {},
      });
    }

    if (!page.hasInsight && page.views >= input.insightMinViews) {
      alerts.push({
        kind: "analysisReady",
        count: page.views,
        severity: "info",
        landingPageId: page.landingPageId,
        context: {},
      });
    }
  }

  /* The money one. `spend.orders` counts only Facebook/Instagram-attributed
     orders, which is the same basis the ad-spend panel uses — comparing it
     against the store's total orders would credit the ad account for a sale
     that came from a WhatsApp link. */
  if (input.spend && input.spend.amount > 0 && input.spend.orders === 0) {
    alerts.push({
      kind: "spendNoOrders",
      count: input.spend.clicks,
      severity: "danger",
      landingPageId: null,
      context: { clicks: input.spend.clicks },
    });
  }

  /* Store-wide "traffic, no orders" — suppressed when the spend alert above
     already says it with more detail, so the band never carries the same news
     twice. */
  const spendAlreadySaysIt = alerts.some((a) => a.kind === "spendNoOrders");
  if (!spendAlreadySaysIt && input.totals.orders === 0 && input.totals.views >= TRIAGE_MIN_VIEWS) {
    alerts.push({
      kind: "noOrders",
      count: input.totals.views,
      severity: "danger",
      landingPageId: null,
      context: {},
    });
  }

  return alerts.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count,
  );
}

/* -----------------------------------------------------------------------------
 * Ranking the AI's recommendations
 * -------------------------------------------------------------------------- */

/**
 * A stored recommendation carries no severity and no meaningful order.
 *
 * BH.3's contract is `{section, finding, suggestion, metric, value}` — the
 * model is never asked to rank, and `parseInsightAnswer` preserves whatever
 * order it happened to emit. So presenting the stored order as a priority list
 * would be a claim the data does not support.
 *
 * What IS trustworthy is `metric` and `value`: grounding validation drops any
 * recommendation whose value does not byte-equal the number in the summary, so
 * both are machine data. That is enough to rank deterministically here, in the
 * render, against the same denominators the funnel uses.
 *
 * `metric` is typed as a bounded string rather than an enum, and the runtime
 * vocabulary can grow (`faq.qN` is positional), so this MUST fall through to
 * `info` on anything it does not recognise rather than dropping the claim.
 */
export type InsightSeverity = "danger" | "warning" | "info";

export interface RankableRecommendation {
  readonly metric: string;
  readonly value: number;
  readonly section: string;
}

export interface InsightContext {
  readonly views: number;
  readonly orders: number;
  /** The analysis's OWN denominator, from its stored `inputSummary` — never
   * the live one. A recommendation written when the page had 120 measured
   * views must be judged against 120, not against today's number. */
  readonly measured: number;
}

export function insightSeverity(
  rec: RankableRecommendation,
  ctx: InsightContext,
): InsightSeverity {
  const { metric, value } = rec;

  // Reaching the form is the funnel's hinge, so it keeps the funnel's floors.
  if (metric === "behavior.sawForm") {
    const r = rate(value, ctx.measured);
    if (r === null) return "info";
    if (r < FORM_REACH_DANGER) return "danger";
    if (r < FORM_REACH_WARNING) return "warning";
    return "info";
  }

  // A claim about where people stopped. Stopping at the TOP is the bad case;
  // stopping deep in the page means they read it, which is not a problem.
  if (metric.startsWith("furthest.")) {
    const landmark = metric.slice("furthest.".length);
    const r = rate(value, ctx.measured);
    if (r === null) return "info";
    if (landmark === "hero") return r >= 0.6 ? "danger" : r >= 0.4 ? "warning" : "info";
    return "info";
  }

  // A zero on any of these is a dead interaction the merchant can act on.
  if (
    metric === "behavior.variantChanges" ||
    metric === "behavior.galleryChanges" ||
    metric === "behavior.stickyBuyClicks"
  ) {
    return value === 0 ? "warning" : "info";
  }

  // The outcomes themselves.
  if (metric === "orders") return value === 0 ? "danger" : "info";
  if (metric === "drafts.started") {
    const r = rate(value, ctx.views);
    return r !== null && r < 0.01 ? "warning" : "info";
  }
  if (metric === "drafts.withPhone") {
    return value === 0 && ctx.orders === 0 ? "warning" : "info";
  }

  // `faq.qN` and anything this table has not met yet. A question customers
  // keep opening is information, not an alarm.
  return "info";
}

const INSIGHT_RANK: Record<InsightSeverity, number> = { danger: 0, warning: 1, info: 2 };

/**
 * Worst first, original order preserved within a severity.
 *
 * A stable sort keeps the model's own sequencing as the tiebreak, which is the
 * most honest thing to do with an ordering that carries no meaning: it is not
 * information, so it is not worth destroying either.
 */
export function rankInsights<T extends RankableRecommendation>(
  recommendations: readonly T[],
  ctx: InsightContext,
): (T & { readonly severity: InsightSeverity })[] {
  return recommendations
    .map((rec) => ({ ...rec, severity: insightSeverity(rec, ctx) }))
    .sort((a, b) => INSIGHT_RANK[a.severity] - INSIGHT_RANK[b.severity]);
}
