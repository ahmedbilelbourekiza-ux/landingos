import { z } from "zod";
import { can } from "@landingos/auth";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { completeWithProvider, AiCallError } from "@/lib/erp/ai-complete";
import { readPlatformAiProvider } from "@/lib/platform/platform-ai";
import { reserveAiCall, settleAiCall } from "@/lib/erp/ai-quota";
import {
  buildCategoryMessages,
  parseCategorySuggestions,
  resolveSuggestions,
  CategoryParseError,
} from "@/lib/landing/ai-category";

export const dynamic = "force-dynamic";

/* =============================================================================
 * CAT.1 — suggest a category for a product.
 *
 * The generate route's exact three-phase shape (D-LP.5.1), because this is the
 * quota's third spender:
 *   plan   — permission, the tenant's existing categories, the provider and
 *            the RESERVATION, inside the wrapper's transaction.
 *   call   — the model, in NO transaction, settling the ledger either way.
 *   answer — resolved suggestions; nothing is written.
 *
 * IT WRITES NOTHING, and that is the design rather than an omission. A
 * category is a public URL and an entry in the shop's navigation, so one
 * appearing because a model thought of it is a storefront change nobody
 * approved. This route answers a question; creating the category is the
 * merchant pressing a button, through `POST /api/builder/categories`, which
 * already owns the slug rules, the digit-only guard and the 409.
 *
 * `website-builder:ai:spend` on top of `pages:write`, SEC.8's rule: writing
 * the page authorises the page-side work, spending the platform's model
 * allowance is its own permission.
 * ========================================================================== */

const Body = z.object({
  productName: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional().nullable(),
});

export const POST = tenantRoute(
  "website-builder:pages:write",
  async ({ db, req, session, afterCommit }) => {
    if (!can(session.auth!, "website-builder:ai:spend")) {
      return apiError(
        403,
        "AI_SPEND_FORBIDDEN",
        "Spending on AI needs its own permission on this company.",
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
    }
    const tenantId = session.auth!.tenantId;

    /* The shop's own vocabulary, which is the whole point of asking a model
     * rather than a dictionary: it must prefer what this merchant already
     * uses. Ordered as the console lists them, so "best first" from the model
     * is judged against a stable list. */
    const existing = (await (db as any).category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    })) as { id: string; name: string }[];

    const provider = await readPlatformAiProvider();
    if (!provider) {
      return apiError(501, "NO_AI_PROVIDER", "AI is not enabled on this platform.");
    }

    const reservation = await reserveAiCall(db, tenantId, "category_suggestion", {
      provider: provider.type,
      model: provider.defaultModel,
    });
    if (!reservation.ok) {
      const { used, limit, resetsAt } = reservation.usage;
      return apiError(
        429,
        "AI_QUOTA_EXCEEDED",
        `This store's monthly AI allowance is used up (${used} of ${limit} calls). It resets on ${resetsAt.toISOString().slice(0, 10)}.`,
        { used, limit, resetsAt: resetsAt.toISOString() },
      );
    }
    const usageEventId = reservation.eventId;

    afterCommit(async () => {
      try {
        const answer = await completeWithProvider(
          {
            type: provider.type,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            defaultModel: provider.defaultModel,
            temperature: provider.temperature ?? null,
            maxTokens: provider.maxTokens ?? null,
            timeoutMs: provider.timeoutMs ?? null,
          },
          buildCategoryMessages({
            productName: parsed.data.productName,
            description: parsed.data.description ?? null,
            existing: existing.map((c) => c.name),
          }),
        );
        await settleAiCall(tenantId, usageEventId, {
          ok: true,
          promptTokens: answer.usage.promptTokens,
          completionTokens: answer.usage.completionTokens,
        });

        return apiOk({
          suggestions: resolveSuggestions(parseCategorySuggestions(answer.text), existing),
        });
      } catch (error) {
        if (error instanceof CategoryParseError) {
          // The call happened and was billed; only the parse failed. The
          // ledger row is already settled `ok`, honestly: the spend is real.
          return apiError(502, "AI_INVALID_OUTPUT", error.message);
        }
        if (error instanceof AiCallError) {
          await settleAiCall(tenantId, usageEventId, { ok: false });
          return apiError(502, error.code, error.message);
        }
        throw error;
      }
    });

    // Replaced by the closure above; stands only if it throws.
    return apiOk({ suggestions: [] });
  },
);
