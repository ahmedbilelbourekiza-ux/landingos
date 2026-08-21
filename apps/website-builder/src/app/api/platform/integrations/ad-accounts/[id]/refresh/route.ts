import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { refreshAccountSpend } from "@/lib/ads/meta-ads";

export const dynamic = "force-dynamic";

/* =============================================================================
 * LB.23 — "Refresh spend": pull this account's window from Meta, now.
 *
 * The credential is resolved from the account ROW inside `refreshAccountSpend`
 * and never travels through this route, so a caller cannot supply one — the
 * only way a token gets in is the intake route, which encrypts it.
 *
 * THE WINDOW IS BOUNDED, and it is bounded here rather than trusted from the
 * client: an unbounded `since` is an unbounded Meta pull and an unbounded
 * write. 90 days covers the 7/30-day screen with room for backfill, and Meta
 * restates recent days as attribution settles, which is why re-running is an
 * upsert rather than an append.
 *
 * Every failure is a NAMED code the console maps to a translated sentence.
 * "No credential" is deliberately its own code and not an upstream error: one
 * has a next action the merchant can take, the other does not.
 * ========================================================================== */

type Params = { id: string };

const MAX_DAYS = 90;

const Body = z.object({
  days: z.coerce.number().int().min(1).max(MAX_DAYS).default(30),
});

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const POST = tenantRoute<Params>(
  "platform:integrations:manage",
  async ({ req, params, session }) => {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
    }

    const until = new Date();
    const since = new Date(until.getTime() - parsed.data.days * 24 * 60 * 60 * 1000);

    const outcome = await refreshAccountSpend(session.auth!.tenantId, params.id, {
      since: isoDay(since),
      until: isoDay(until),
    });

    if (outcome.ok) {
      return apiOk({ written: outcome.written, days: parsed.data.days });
    }

    switch (outcome.code) {
      case "NO_ACCOUNT":
        return apiError(404, "NOT_FOUND", "That advertising account does not exist.");
      case "NO_CREDENTIAL":
        // 409, not 401/403: the CALLER is authorised, the ACCOUNT is not
        // connected. A 403 here would send someone to look at permissions.
        return apiError(
          409,
          "NO_CREDENTIAL",
          "This advertising account has no access token saved yet.",
        );
      default:
        // Meta's own words, not ours — inventing wording here would hide which
        // system refused and why.
        return apiError(
          502,
          "UPSTREAM_ERROR",
          outcome.error ?? "The advertising provider refused the request.",
        );
    }
  },
);
