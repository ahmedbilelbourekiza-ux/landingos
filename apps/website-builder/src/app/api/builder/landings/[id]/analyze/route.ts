import { withTenant } from "@landingos/db";
import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { completeWithProvider, AiCallError } from "@/lib/erp/ai-complete";
import { reserveAiCall, settleAiCall } from "@/lib/erp/ai-quota";
import { buildInsightSummary } from "@/lib/builder/insight-summary";
import {
  buildInsightMessages,
  parseInsightAnswer,
  InsightParseError,
  INSIGHT_COOLDOWN_MS,
  INSIGHT_MIN_VIEWS,
} from "@/lib/landing/ai-insight";

export const dynamic = "force-dynamic";

type Params = { id: string };

/* =============================================================================
 * Analyze one landing page's behavior aggregates (BH.3) — on demand, never
 * scheduled.
 *
 * The generate route's exact three-phase shape (D-LP.5.1), with the same
 * AQ.1 gate — this is the second spender the quota was built for:
 *   plan   — page + cooldown + summary + data floor + provider + RESERVE,
 *            inside the wrapper's transaction; write only the reservation.
 *   call   — the model, in NO transaction; settle the ledger either way.
 *   record — LandingInsight in one fresh short transaction, so a refused
 *            answer stores nothing.
 *
 * Order of refusals is deliberate: the cooldown re-shows a young stored
 *  insight BEFORE anything else (re-showing is free; regenerating is money),
 * the data floor refuses before the provider is even loaded ("not enough
 * signal yet" beats confident noise), and the quota reserves last so a
 * refusal for any other reason never consumes an allowance slot.
 *
 * The model sees `InsightSummary` — aggregates only, by type. Raw visit
 * rows, names, phones and order details are not in the input's shape, so
 * they cannot ride to a provider by accident.
 * ========================================================================== */

const Body = z.object({
  days: z.union([z.literal(7), z.literal(30)]).optional(),
});

const insightShape = (row: any, cached: boolean) => ({
  id: row.id,
  windowDays: row.windowDays,
  recommendations: row.recommendations,
  createdAt: row.createdAt,
  cached,
});

export const POST = tenantRoute<Params>("website-builder:pages:write", async ({ db, req, session, params, afterCommit }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const days = parsed.data.days ?? 30;
  const tenantId = session.auth!.tenantId;

  const page = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      faqs: { select: { id: true, question: true }, orderBy: { displayOrder: "asc" } },
    },
  });
  if (!page) return apiError(404, "NOT_FOUND", "No such page.");

  // A stored analysis younger than the cooldown is RE-SHOWN, not re-billed.
  const latest = await (db as any).landingInsight.findFirst({
    where: { landingPageId: page.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, windowDays: true, recommendations: true, createdAt: true },
  });
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < INSIGHT_COOLDOWN_MS) {
    return apiOk(insightShape(latest, true));
  }

  const summary = await buildInsightSummary(db, page, days);
  if (summary.views < INSIGHT_MIN_VIEWS) {
    return apiError(
      422,
      "INSUFFICIENT_DATA",
      `Not enough traffic to analyze yet (${summary.views} of ${INSIGHT_MIN_VIEWS} views in the window).`,
      { views: summary.views, needed: INSIGHT_MIN_VIEWS },
    );
  }

  const provider = await (db as any).aiProvider.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      type: true, baseUrl: true, apiKey: true, defaultModel: true,
      temperature: true, maxTokens: true, timeoutMs: true,
    },
  });
  if (!provider) {
    return apiError(501, "NO_AI_PROVIDER", "No model provider is configured for this company.");
  }

  const reservation = await reserveAiCall(db, tenantId, "behavior_insight", {
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
    let recommendations;
    try {
      const answer = await completeWithProvider(
        {
          type: provider.type,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          defaultModel: provider.defaultModel,
          temperature: provider.temperature == null ? null : Number(provider.temperature),
          maxTokens: provider.maxTokens,
          timeoutMs: provider.timeoutMs,
        },
        buildInsightMessages(summary),
      );
      await settleAiCall(tenantId, usageEventId, {
        ok: true,
        promptTokens: answer.usage.promptTokens,
        completionTokens: answer.usage.completionTokens,
      });
      recommendations = parseInsightAnswer(answer.text, summary);
    } catch (error) {
      if (error instanceof InsightParseError) {
        // The call happened and was settled ok above — the spend is real;
        // only the answer failed its grounding, and nothing is stored.
        return apiError(502, "AI_INVALID_OUTPUT", error.message);
      }
      if (error instanceof AiCallError) {
        await settleAiCall(tenantId, usageEventId, { ok: false });
        return apiError(502, error.code, error.message);
      }
      throw error;
    }

    const created = await withTenant(tenantId, (tx) =>
      (tx as any).landingInsight.create({
        data: {
          tenantId,
          landingPageId: page.id,
          windowDays: days,
          inputSummary: summary as never,
          recommendations: recommendations as never,
          provider: provider.type,
          model: provider.defaultModel,
        },
        select: { id: true, windowDays: true, recommendations: true, createdAt: true },
      }),
    );
    return apiOk(insightShape(created, false), { status: 201 });
  });

  // Replaced by `afterCommit`; stands only if the closure throws.
  return apiError(500, "INTERNAL_ERROR", "Analysis did not complete.");
});
