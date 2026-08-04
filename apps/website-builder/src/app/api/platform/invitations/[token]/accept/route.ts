import { apiOk, apiError } from "@/lib/api/route";
import { acceptInvitation } from "@/lib/platform/team";

export const dynamic = "force-dynamic";

/* =============================================================================
 * POST /api/platform/invitations/[token]/accept — Phase 7.1b.
 *
 * The acceptance endpoint. NOT a `tenantRoute`: the accepter is by definition
 * not yet a member of the inviting tenant, and the link is followed before any
 * session exists. The token is the claim, resolved through `withInvitationToken`
 * inside `acceptInvitation` — the narrow RLS policy that opens exactly the one
 * row whose token was presented.
 *
 * WHY AN API ROUTE AND NOT A SERVER ACTION. Every other write surface on this
 * platform is an API route with contract tests in front of it (D-06.1), because
 * a server action is a second write path with its own copy of the gate that no
 * contract test covers — and worse, a server action is not HTTP-addressable, so
 * it cannot be contract-tested over `fetch` at all. The page's form calls THIS
 * route; it does not get its own action.
 *
 * Returns the standard envelope. A test that only checked the status would pass
 * against a route that refused for the wrong reason, so every refusal carries a
 * CODE and the tests assert it.
 * ========================================================================== */

type Params = { token: string };

export async function POST(_req: Request, ctx: { params: Promise<Params> }) {
  const { token } = await ctx.params;
  const result = await acceptInvitation(token);

  if (result.kind === "refusal") {
    return apiError(result.refusal.status, result.refusal.code, result.refusal.message);
  }

  return apiOk({
    membership: result.membership,
    // The caller lands themselves; this route does not switch their session
    // (D-07.4: landing is the person's operation, not a side effect of accept).
  });
}
