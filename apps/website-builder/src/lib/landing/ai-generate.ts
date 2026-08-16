import { z } from "zod";

import { DEFAULT_BENEFIT_ICON, BENEFIT_ICONS } from "./benefit-icons.ts";
import type { AiMessage } from "../erp/ai-complete.ts";

/* =============================================================================
 * The prompt and the contract for AI-generated landing copy (LB.24).
 *
 * NO `server-only`: everything here is pure — prompt text in, parsed copy out
 * — so the suite exercises the whole pipeline without a model (the calc.ts
 * rule). The route owns the network and the database.
 *
 * THE REGISTER IS THE PRODUCT. The differentiator is not that copy appears;
 * it is that the copy reads like an Algerian seller wrote it for Algerian
 * customers — Darija where a seller sells (headline, announcement, benefits,
 * description), clear reassuring Arabic where a buyer checks facts (FAQ), and
 * searchable Arabic for the SEO pair. The demo fixtures already model this mix
 * (MSA-leaning specs, Darija social proof — see seed-demo.ts) and the prompt
 * states it explicitly rather than hoping the model guesses.
 *
 * TWO LINES THE PROMPT DRAWS ON PURPOSE:
 * - No invented facts: the model writes ONLY from the merchant's selling
 *   points. A generated warranty or spec the product does not have is a
 *   refund and a lost customer, not copy.
 * - No reviews, ever: fabricated customers presented as real ones is
 *   manufactured social proof. The merchant adds real reviews later; the
 *   generator never writes them.
 * ========================================================================== */

export interface GenerationFacts {
  readonly productName: string;
  readonly price: number;
  readonly oldPrice: number | null;
  readonly currency: string;
  readonly sellingPoints: readonly string[];
  readonly category: string | null;
}

const ICON_KEYS = Object.keys(BENEFIT_ICONS);

/* What the model must return. Bounds sit INSIDE the section routes' server
 * schemas (title ≤200→120 to also satisfy the editor's client schema,
 * announcement ≤500→200, benefit title ≤120→80, faq q ≤300→200 / a ≤2000→1000,
 * seoTitle ≤200→120, seoDescription ≤500→300) so a valid generation can never
 * be rejected by the editor it lands in. */
export const GeneratedCopy = z.object({
  title: z.string().trim().min(4).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60)
    .optional(),
  announcement: z.string().trim().min(1).max(200).optional(),
  /* 300, not the general route's 20000: the EDITOR's client schema
   * (buildGeneralSchema) caps description at 300, and a draft the editor
   * refuses to re-save is a trap, not a head start. */
  description: z.string().trim().min(40).max(300),
  ctaButtonText: z.string().trim().min(2).max(40).optional(),
  benefits: z
    .array(
      z.object({
        icon: z.string().trim().max(40).optional(),
        title: z.string().trim().min(2).max(80),
        description: z.string().trim().max(300).optional().nullable(),
      }),
    )
    .min(3)
    .max(8),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(4).max(200),
        answer: z.string().trim().min(4).max(1000),
      }),
    )
    .min(3)
    .max(8),
  seoTitle: z.string().trim().min(4).max(120).optional(),
  seoDescription: z.string().trim().min(10).max(300).optional(),
});
export type GeneratedCopyData = z.infer<typeof GeneratedCopy>;

/* ---------------------------------------------------------------------------
 * Prompt
 * ------------------------------------------------------------------------ */

const SYSTEM_PROMPT = [
  "أنت كاتب إعلانات جزائري محترف، تكتب صفحات هبوط لمنتجات تُباع بالدفع عند الاستلام (COD) في الجزائر.",
  "",
  "قواعد اللغة — هذا هو جوهر عملك:",
  "- اكتب بالدارجة الجزائرية الطبيعية، كما يكتب البائع الجزائري الناجح لزبائنه على فيسبوك وإنستغرام. ماشي عربية فصحى مترجمة من الإنجليزية.",
  "- من ملامح النبرة الجزائرية: «بصح»، «برك»، «بزاف»، «تاع»، «ديما»، «يوصلك حتى باب دارك»، «التوصيل متوفر 58 ولاية»، «تخلص كي توصلك السلعة». استعملها حيث تجي طبيعية، بلا مبالغة.",
  "- العنوان، الإعلان، المزايا، والوصف: دارجة حيّة وبيعية تحسّها من إنسان حقيقي.",
  "- الأسئلة الشائعة: إجابات واضحة ومطمئنة بدارجة مفهومة — التوصيل، الدفع عند الاستلام، الإرجاع.",
  "- seoTitle و seoDescription: عربية أوضح وقابلة للبحث، مع ذكر الجزائر.",
  "",
  "قواعد صارمة:",
  "- الأرقام الغربية فقط (0-9)، أبداً الأرقام المشرقية (٠-٩). العملة تُكتب كما وردت في المعطيات.",
  "- لا تخترع مواصفات ولا ضمانات ولا وقائع غير موجودة في نقاط البيع المعطاة. زخرِف الصياغة، لا الحقائق.",
  "- لا تكتب آراء زبائن ولا تقييمات — التاجر يضيف آراء زبائنه الحقيقيين بنفسه.",
  "- أجب بكائن JSON واحد فقط: بدون أسوار ماركداون، بدون أي نص قبله أو بعده. المفاتيح بالإنجليزية كما في المخطط، والقيم النصية بالعربية (إلا slug باللاتينية).",
].join("\n");

/** The schema description the model writes against, with the icon vocabulary. */
const outputContract = () =>
  [
    "أعد JSON بهذه المفاتيح بالضبط:",
    "{",
    '  "title": "عنوان بيعي للصفحة (4-120 حرف)",',
    '  "slug": "عنوان-لاتيني-قصير مشتق من اسم المنتج (حروف لاتينية صغيرة وأرقام وشرطات، 3-60 حرف)",',
    '  "announcement": "شريط إعلان قصير فوق الصفحة، عرض أو طمأنة (اختياري، ≤200 حرف)",',
    '  "description": "وصف قصير ومقنع للمنتج بالدارجة، فقرة أو فقرتان قصيرتان (40-300 حرف) — التفاصيل الأخرى تروح في المزايا والأسئلة",',
    '  "ctaButtonText": "نص زر الطلب (اختياري، ≤40 حرف، مثال: اطلب الآن)",',
    `  "benefits": [4-6 عناصر: {"icon": "مفتاح من: ${ICON_KEYS.join(", ")}", "title": "ميزة (≤80)", "description": "شرح قصير (≤300، اختياري)"}],`,
    '  "faqs": [4-6 عناصر: {"question": "سؤال (≤200)", "answer": "جواب (≤1000)"} — لازم يكون فيها سؤال عن التوصيل وسؤال عن الدفع عند الاستلام],',
    '  "seoTitle": "عنوان لمحركات البحث (≤120)",',
    '  "seoDescription": "وصف لمحركات البحث (≤300)"',
    "}",
  ].join("\n");

export function buildGenerationMessages(facts: GenerationFacts): AiMessage[] {
  const user = [
    "معطيات المنتج (المصدر الوحيد للحقائق):",
    JSON.stringify(
      {
        productName: facts.productName,
        price: facts.price,
        ...(facts.oldPrice != null ? { oldPrice: facts.oldPrice } : {}),
        currency: facts.currency,
        sellingPoints: facts.sellingPoints,
        ...(facts.category ? { category: facts.category } : {}),
      },
      null,
      2,
    ),
    "",
    outputContract(),
  ].join("\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/* ---------------------------------------------------------------------------
 * Parsing + normalization
 * ------------------------------------------------------------------------ */

/** Eastern Arabic and Persian digits → Western, the repo-wide convention
 * (formatMoney forces latn; the i18n suite rejects [٠-٩] leaks). Applied
 * mechanically so one slipped numeral does not fail a whole generation. */
export function westernizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Models love fences even when told not to. Take the outermost object. */
export function extractJsonObject(answer: string): string | null {
  const stripped = answer.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

export class GenerationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationParseError";
  }
}

/** Answer text → validated, normalized copy. Throws GenerationParseError. */
export function parseGeneratedCopy(answer: string): GeneratedCopyData {
  const jsonText = extractJsonObject(westernizeDigits(answer));
  if (!jsonText) throw new GenerationParseError("The answer contains no JSON object.");

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new GenerationParseError("The answer's JSON does not parse.");
  }

  const parsed = GeneratedCopy.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new GenerationParseError(
      `The answer does not match the copy contract (${issue?.path.join(".")}: ${issue?.message}).`,
    );
  }

  // Unknown icon keys degrade to the default rather than failing the page —
  // the render layer already treats unknown keys this way (benefit-icons.ts).
  return {
    ...parsed.data,
    benefits: parsed.data.benefits.map((b) => ({
      ...b,
      icon: b.icon && ICON_KEYS.includes(b.icon) ? b.icon : DEFAULT_BENEFIT_ICON,
    })),
  };
}
