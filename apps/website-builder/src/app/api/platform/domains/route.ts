import { randomBytes } from "node:crypto";

import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { normalizeDomain } from "@/lib/platform/domains";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Custom domains — CAPABILITY_AUDIT B5.
 *
 * The READ path has been complete and safe since the schema landed:
 * `tenantByDomain` refuses any row without `verifiedAt`, so an unverified
 * claim serves nothing. These routes are the write half that never existed —
 * a tenant lists and claims hostnames here; DNS proof happens in ./[id]/verify.
 *
 * `platform:domains:manage` is SENSITIVE (rbac.ts): a verified domain decides
 * where customer traffic goes, so only OWNER/ADMIN reach any of this by role.
 * The tenant binding scopes every read and write to the caller's own rows;
 * the GLOBAL uniqueness of a hostname is the database's @unique, which sees
 * across tenants precisely because RLS-bound queries must not.
 * ========================================================================== */

const MAX_DOMAINS = 5;

export const GET = tenantRoute("platform:domains:manage", async ({ db }) => {
  const items = await (db as any).tenantDomain.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, domain: true, verificationToken: true,
      verifiedAt: true, isPrimary: true, createdAt: true,
    },
  });
  return apiOk({ items });
});

const Body = z.object({ domain: z.string().trim().min(4).max(253) });

export const POST = tenantRoute("platform:domains:manage", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", "Send a hostname.");

  const domain = normalizeDomain(parsed.data.domain);
  if (!domain) {
    return apiError(422, "INVALID_DOMAIN", "That is not a claimable hostname — use your own domain, like shop.example.com.");
  }

  const count = await (db as any).tenantDomain.count();
  if (count >= MAX_DOMAINS) {
    return apiError(422, "DOMAIN_LIMIT", `A workspace can hold ${MAX_DOMAINS} domains.`);
  }

  try {
    const created = await (db as any).tenantDomain.create({
      data: {
        tenantId: session.auth!.tenantId,
        domain,
        // 128 random bits; published in DNS by the OWNER of the zone, which
        // is the entire proof. Never derived from anything guessable.
        verificationToken: `landingos-verify=${randomBytes(16).toString("hex")}`,
      },
      select: { id: true, domain: true, verificationToken: true },
    });
    return apiOk(created, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") {
      // The @unique constraint sees across tenants (RLS-bound reads must
      // not). "Taken" reveals existence and nothing else — the same answer
      // a signup slug clash gives.
      return apiError(409, "DOMAIN_TAKEN", "That hostname is already linked.");
    }
    throw error;
  }
});
