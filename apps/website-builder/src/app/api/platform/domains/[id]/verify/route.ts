import { resolveTxt } from "node:dns/promises";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";
type Params = { id: string };

/* The DNS proof — B5, and the one step that keeps hostname theft impossible.
 *
 * The tenant publishes the row's token as a TXT record at
 * `_landingos-verify.<domain>`; only the zone's real owner can. This route
 * looks the record up and sets `verifiedAt` on an exact match — nothing else
 * writes that column, and `tenantByDomain` refuses rows without it, which is
 * the read-side half that has been in place since the schema landed.
 *
 * Failure detail is deliberately specific ("no record" vs "records exist but
 * none match"): the caller is the domain's OWNER mid-setup, and DNS
 * propagation is exactly the case they need distinguished. Nothing here
 * reveals another tenant's anything — the row is reached through the
 * caller's own binding.
 *
 * LB.14c — THAT DISTINCTION IS IN THE CODE, NOT ONLY IN THE MESSAGE. It used
 * to be one code (`VERIFICATION_FAILED`) carrying two meanings in an English
 * developer message, and `lib/console/action-errors.ts` states that a screen
 * keys off the CODE and never shows the message. So the two cases the comment
 * above calls essential arrived at the merchant as one untranslated fallback:
 * "that didn't work" — measured in the running console. A code per cause is
 * what makes the distinction reach the person who has to act on it.
 */

export const POST = tenantRoute<Params>("platform:domains:manage", async ({ db, params }) => {
  const row = await (db as any).tenantDomain.findUnique({
    where: { id: params.id },
    select: { id: true, domain: true, verificationToken: true, verifiedAt: true },
  });
  if (!row) return apiError(404, "NOT_FOUND", "That domain is not linked here.");
  if (row.verifiedAt) return apiOk({ id: row.id, verifiedAt: row.verifiedAt });

  let records: string[][];
  try {
    records = await resolveTxt(`_landingos-verify.${row.domain}`);
  } catch {
    return apiError(
      422,
      "DNS_NO_RECORD",
      `No TXT record found at _landingos-verify.${row.domain} — create it with the token, then allow time for DNS to propagate.`,
    );
  }

  // A TXT record arrives as chunks; the value is their concatenation.
  const found = records.some((chunks) => chunks.join("") === row.verificationToken);
  if (!found) {
    return apiError(
      422,
      "DNS_TOKEN_MISMATCH",
      "A TXT record exists but none matches the token exactly.",
    );
  }

  const verifiedAt = new Date();
  await (db as any).tenantDomain.updateMany({
    where: { id: row.id },
    data: { verifiedAt },
  });
  return apiOk({ id: row.id, verifiedAt });
});
