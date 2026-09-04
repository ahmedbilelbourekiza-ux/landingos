import { z } from "zod";

import { extractJsonObject, westernizeDigits } from "./ai-generate.ts";
import type { AiMessage } from "../erp/ai-complete.ts";

/* =============================================================================
 * The prompt and the contract for AI behavior analysis (BH.3).
 *
 * NO `server-only`: pure, the ai-generate.ts rule — summary in, prompt out;
 * answer text in, validated recommendations out. The route owns the network,
 * the database and the quota.
 *
 * THE MODEL SEES AGGREGATES, NEVER ROWS. The input is `InsightSummary` — the
 * same numbers the Traffic screen renders, plus the drafts funnel and the
 * per-question FAQ opens — a couple of KB of counts. No name, phone, address
 * or order detail can reach the provider because none is ever in the input
 * type. (§BH.3's privacy line, held by construction rather than by care.)
 *
 * A RECOMMENDATION IS A CLAIM WITH ITS NUMBER. Every item must name a
 * `metric` key present in the summary AND repeat its exact `value`; an item
 * that cannot is dropped in validation (never shown), and an answer with no
 * surviving item is refused whole. This is "no invented facts" pointed at
 * analysis: grounding is checked mechanically, not hoped for.
 *
 * THE KNOBS (product values, not engineering ones — §BH.6.3's proposed
 * defaults, recorded as chosen-by-default overnight, revisitable):
 * cooldown 24h (a younger stored analysis is re-shown, not re-billed),
 * data floor 100 views in the window ("not enough signal yet" beats
 * confident noise — the LB.22 white-image principle).
 * ========================================================================== */

export const INSIGHT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const INSIGHT_MIN_VIEWS = 100;

/** What the model is shown, and what LandingInsight.inputSummary stores.
 * Counts only, by type: nothing merchant- or customer-identifying beyond the
 * page's own public title. */
export interface InsightSummary {
  readonly windowDays: number;
  readonly pageTitle: string;
  readonly views: number;
  readonly orders: number;
  /** Null when the page has no measured views (opt-in off, or no flush yet). */
  readonly behavior: {
    readonly measured: number;
    readonly sawForm: number;
    readonly furthest: Readonly<Record<string, number>>;
    readonly faqOpens: number;
    readonly galleryChanges: number;
    readonly variantChanges: number;
    readonly stickyBuyClicks: number;
    readonly whatsappClicks: number;
    readonly avgActiveMs: number;
  } | null;
  /** Per-question opens, unnested from faqOpenedIds, keyed faq.q1.. so a
   * recommendation can cite the exact doubt customers keep opening. */
  readonly faqQuestions: ReadonlyArray<{
    readonly key: string;
    readonly question: string;
    readonly opens: number;
  }>;
  readonly drafts: { readonly started: number; readonly withPhone: number };
}

/** The flat metric vocabulary a recommendation may cite — every number in the
 * summary under a stable dotted key. Exported pure so the suite can assert
 * the vocabulary and the validator agree. */
export function flattenSummaryMetrics(summary: InsightSummary): Record<string, number> {
  const metrics: Record<string, number> = {
    views: summary.views,
    orders: summary.orders,
    "drafts.started": summary.drafts.started,
    "drafts.withPhone": summary.drafts.withPhone,
  };
  if (summary.behavior) {
    metrics["behavior.measured"] = summary.behavior.measured;
    metrics["behavior.sawForm"] = summary.behavior.sawForm;
    metrics["behavior.faqOpens"] = summary.behavior.faqOpens;
    metrics["behavior.galleryChanges"] = summary.behavior.galleryChanges;
    metrics["behavior.variantChanges"] = summary.behavior.variantChanges;
    metrics["behavior.stickyBuyClicks"] = summary.behavior.stickyBuyClicks;
    metrics["behavior.whatsappClicks"] = summary.behavior.whatsappClicks;
    metrics["behavior.avgActiveMs"] = summary.behavior.avgActiveMs;
    for (const [section, count] of Object.entries(summary.behavior.furthest)) {
      metrics[`furthest.${section}`] = count;
    }
  }
  for (const q of summary.faqQuestions) metrics[q.key] = q.opens;
  return metrics;
}

/** Where a recommendation points. The template's own section vocabulary plus
 * `general` for advice about the page as a whole. */
export const INSIGHT_SECTIONS = [
  "hero",
  "gallery",
  "description",
  "benefits",
  "reviews",
  "faq",
  "form",
  "announcement",
  "general",
] as const;

export const InsightRecommendation = z.object({
  section: z.enum(INSIGHT_SECTIONS),
  finding: z.string().trim().min(10).max(300),
  suggestion: z.string().trim().min(10).max(500),
  metric: z.string().trim().min(1).max(80),
  value: z.number(),
});
export type InsightRecommendationData = z.infer<typeof InsightRecommendation>;

const InsightAnswer = z.object({
  recommendations: z.array(InsightRecommendation).min(1).max(6),
});

/* ---------------------------------------------------------------------------
 * Prompt
 * ------------------------------------------------------------------------ */

/* TR.1 — WHICH LANGUAGE THE ADVICE COMES BACK IN.
 *
 * This prompt used to hard-code Arabic, and `buildInsightMessages` took no
 * locale. The console, meanwhile, translates everything around the advice —
 * the section chip, the date line, the headings — so an English or French
 * merchant read an Arabic sentence wearing an English label, on one line. The
 * mix was structural, not occasional, and it could not be fixed in the
 * rendering: the words arrive in the language the prompt asked for.
 *
 * The instruction is per locale rather than "answer in the user's language",
 * because the input carries a `pageTitle` that is usually Arabic and a model
 * told to match "the user" follows the data instead of the reader.
 *
 * The rest of the rules stay identical in every language, including the
 * Western-digits rule: `westernizeDigits` at parse time depends on it, and the
 * grounding check compares numbers byte for byte.
 */
const LANGUAGE_RULE: Record<string, string> = {
  ar: "- اكتب finding و suggestion بعربية واضحة ومهنية يفهمها تاجر جزائري، مختصرة وعملية.",
  fr: "- Rédige finding et suggestion en français clair et professionnel, court et concret, pour un commerçant algérien.",
  en: "- Write finding and suggestion in clear, professional English — short and practical, for an Algerian merchant.",
};

const DEFAULT_LANGUAGE_RULE = LANGUAGE_RULE.ar!;

function systemPrompt(locale: string): string {
  return [
    "أنت محلّل تسويق لصفحات هبوط تُباع بالدفع عند الاستلام في الجزائر. تقرأ أرقاماً مجمَّعة عن سلوك زوار صفحة واحدة وتقترح تحسينات عملية يقدر التاجر يطبّقها في محرّر الصفحة.",
    "",
    "قواعد صارمة:",
    "- كل توصية لازم تستند إلى رقم موجود في المعطيات، وتذكر المفتاح (metric) وقيمته (value) كما وردا بالضبط. توصية بلا رقمها تُرفض آلياً.",
    "- لا تخترع أرقاماً ولا نسباً غير قابلة للاشتقاق المباشر من المعطيات، ولا تفترض أسباباً ما تشهد عليها الأرقام.",
    LANGUAGE_RULE[locale] ?? DEFAULT_LANGUAGE_RULE,
    "- الأرقام الغربية فقط (0-9).",
    "- أجب بكائن JSON واحد فقط: بدون ``` وبدون أي نص قبله أو بعده.",
  ].join("\n");
}

const outputContract = () =>
  [
    "أعد JSON بهذه البنية بالضبط:",
    "{",
    '  "recommendations": [1-6 عناصر: {',
    `    "section": "واحدة من: ${INSIGHT_SECTIONS.join(", ")}",`,
    '    "finding": "الملاحظة المستندة إلى الرقم (10-300 حرف)",',
    '    "suggestion": "التحسين المقترح، خطوة عملية في المحرّر (10-500 حرف)",',
    '    "metric": "مفتاح الرقم من المعطيات كما هو",',
    '    "value": الرقم كما ورد بالضبط',
    "  }]",
    "}",
  ].join("\n");

/**
 * @param locale The console locale the answer will be READ in ("ar" | "fr" |
 *   "en"). Anything else falls back to Arabic, which is this platform's
 *   default locale — an unknown locale must not silently produce English for a
 *   merchant whose console is not in English.
 */
export function buildInsightMessages(summary: InsightSummary, locale: string): AiMessage[] {
  const user = [
    "المعطيات المجمَّعة للصفحة (المصدر الوحيد للأرقام — المفاتيح المسموح ذكرها في metric هي مفاتيح flatMetrics):",
    JSON.stringify({ summary, flatMetrics: flattenSummaryMetrics(summary) }, null, 2),
    "",
    outputContract(),
  ].join("\n");

  return [
    { role: "system", content: systemPrompt(locale) },
    { role: "user", content: user },
  ];
}

/* ---------------------------------------------------------------------------
 * Parsing + grounding validation
 * ------------------------------------------------------------------------ */

export class InsightParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsightParseError";
  }
}

/**
 * Answer text → the recommendations that survive grounding. An item citing a
 * metric key absent from the summary, or misquoting its value, is DROPPED —
 * refused in validation, never shown (§BH.3). Zero survivors refuses the
 * whole answer, so a stored insight always has at least one grounded claim.
 */
export function parseInsightAnswer(
  answer: string,
  summary: InsightSummary,
): InsightRecommendationData[] {
  const jsonText = extractJsonObject(westernizeDigits(answer));
  if (!jsonText) throw new InsightParseError("The answer contains no JSON object.");

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new InsightParseError("The answer's JSON does not parse.");
  }

  const parsed = InsightAnswer.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new InsightParseError(
      `The answer does not match the insight contract (${issue?.path.join(".")}: ${issue?.message}).`,
    );
  }

  const metrics = flattenSummaryMetrics(summary);
  const grounded = parsed.data.recommendations.filter(
    (rec) => rec.metric in metrics && metrics[rec.metric] === rec.value,
  );
  if (!grounded.length) {
    throw new InsightParseError("No recommendation cited a real metric with its real value.");
  }
  return grounded;
}
