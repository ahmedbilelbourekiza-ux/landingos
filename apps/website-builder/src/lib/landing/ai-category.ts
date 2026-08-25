import { z } from "zod";

import type { AiMessage } from "../erp/ai-complete.ts";

/* =============================================================================
 * CAT.1 — suggesting a category for a product.
 *
 * NO `server-only`: prompt text in, parsed answer out, exactly like
 * `ai-generate.ts`. The route owns the network, the quota and the database, so
 * the whole contract can be exercised by the suite without a model.
 *
 * -----------------------------------------------------------------------------
 * WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT
 *
 * The merchant asked to stop maintaining a Categories screen by hand. The
 * screen turns out to be load-bearing — it drives the storefront's category
 * listings, the store home's nav, and every category URL in `sitemap.xml` — so
 * the CONCEPT stays and the CHORE goes: one field on the page editor where a
 * merchant types freely or picks what exists, with a suggestion beside it.
 *
 * THE MODEL PREFERS WHAT ALREADY EXISTS. That is the whole value. A merchant
 * with "Montres" does not want "Watches", "Horlogerie" and "Montres Homme" as
 * three sibling categories with three URLs and three nav entries — the mess
 * `productCategories` (LB.19) exists to stop on the ERP side. So the tenant's
 * current categories go INTO the prompt and the model is told, in as many
 * words, to reuse one unless the product genuinely belongs somewhere new.
 *
 * IT NEVER AUTO-ASSIGNS, and that is a product rule rather than caution: a
 * category is a public URL and an entry in the shop's navigation. A model
 * quietly creating one is a change to the storefront that nobody approved. The
 * route returns SUGGESTIONS; the merchant picks.
 *
 * WHAT THE MODEL IS GIVEN: the product's own name and description, and the
 * names of categories this tenant already has. No prices, no customers, no
 * orders, no other tenant's anything — the same shape of restraint
 * `buildInsightMessages` applies, and for the same reason: what is not in the
 * input cannot travel to a provider by accident.
 * ========================================================================== */

/** How many suggestions are worth showing. More is a list, not a suggestion. */
export const MAX_CATEGORY_SUGGESTIONS = 3;

export interface CategoryFacts {
  readonly productName: string;
  readonly description: string | null;
  /** The tenant's existing category names, in the order the console lists them. */
  readonly existing: readonly string[];
}

/* The model answers with names only. Deliberately NOT ids: an id is a fact
 * about this database and inventing a plausible one is exactly the thing
 * language models are good at. The route resolves a name back to an existing
 * category itself, case-insensitively, and anything unmatched is offered as
 * something NEW — which the merchant then has to accept. */
export const SuggestedCategories = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        /** One short clause the merchant can judge. Never shown as fact. */
        reason: z.string().trim().max(120).optional(),
      }),
    )
    .max(MAX_CATEGORY_SUGGESTIONS),
});

export type SuggestedCategoriesAnswer = z.infer<typeof SuggestedCategories>;

export class CategoryParseError extends Error {}

const SYSTEM = [
  "You classify e-commerce products into shop categories.",
  "",
  "You are given a product and the categories a shop ALREADY uses.",
  "",
  "Rules:",
  "1. STRONGLY prefer an existing category. Reuse one whenever the product",
  "   plausibly belongs there. A shop with three near-identical categories is",
  "   worse for its customers than a shop with one slightly broad one.",
  "2. Only propose a NEW category when the product clearly belongs to none of",
  "   them. Name it the way the shop names its own: same language, same",
  "   register, same level of generality.",
  "3. Never invent facts about the product. Classify only from what you are",
  "   given.",
  `4. Return at most ${MAX_CATEGORY_SUGGESTIONS}, best first.`,
  "",
  'Answer with JSON only: {"suggestions":[{"name":"...","reason":"..."}]}',
  "The reason is one short clause explaining the fit, in the same language as",
  "the category name.",
].join("\n");

export function buildCategoryMessages(facts: CategoryFacts): AiMessage[] {
  const existing = facts.existing.length
    ? facts.existing.map((name) => `- ${name}`).join("\n")
    : "(this shop has no categories yet)";

  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        `Product name: ${facts.productName}`,
        facts.description ? `Product description: ${facts.description}` : null,
        "",
        "Categories this shop already uses:",
        existing,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    },
  ];
}

/**
 * Parse the model's answer, tolerating the fence it sometimes wraps JSON in.
 *
 * Same leniency as `parseGeneratedCopy`, and for the same reason: a refusal
 * here costs a call the tenant has already been billed for.
 */
export function parseCategorySuggestions(text: string): SuggestedCategoriesAnswer {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new CategoryParseError("The model did not answer with JSON.");
  }
  const parsed = SuggestedCategories.safeParse(raw);
  if (!parsed.success) {
    throw new CategoryParseError(
      parsed.error.issues[0]?.message ?? "The model's answer was not the expected shape.",
    );
  }
  return parsed.data;
}

export interface ResolvedSuggestion {
  readonly name: string;
  readonly reason: string | null;
  /** The category this names, when the shop already has it. */
  readonly existingId: string | null;
}

/**
 * Match each suggestion back to a real category, or mark it as new.
 *
 * Case- and space-insensitive, because a model answering "montres" for a
 * category stored as "Montres" means the existing one — and creating a second
 * category differing only in case is the exact duplication this feature is
 * meant to prevent.
 */
export function resolveSuggestions(
  answer: SuggestedCategoriesAnswer,
  existing: readonly { id: string; name: string }[],
): ResolvedSuggestion[] {
  const fold = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const byName = new Map(existing.map((c) => [fold(c.name), c]));

  const seen = new Set<string>();
  const out: ResolvedSuggestion[] = [];
  for (const suggestion of answer.suggestions) {
    const key = fold(suggestion.name);
    if (!key || seen.has(key)) continue; // the model repeating itself is one answer
    seen.add(key);
    const match = byName.get(key);
    out.push({
      // The SHOP's spelling wins when it has one, so the list never shows a
      // merchant their own category under a name they did not choose.
      name: match ? match.name : suggestion.name.trim(),
      reason: suggestion.reason?.trim() || null,
      existingId: match?.id ?? null,
    });
  }
  return out;
}
