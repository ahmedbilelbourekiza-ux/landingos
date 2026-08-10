import { z } from "zod";

import { asPlatform } from "@landingos/db";
import { LOCALES } from "@landingos/i18n";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Workspace defaults — B9 (CAPABILITY_AUDIT). `Tenant.name/locale/currency/
 * timezone` were frozen at signup: NO tenant.update call existed anywhere in
 * the platform. The slug stays immutable here on purpose — it is every public
 * URL the tenant has ever shared.
 *
 * Tenant is deliberately UNSCOPED (the tenancy root — RLS cannot bind before
 * a tenant is known), so the ONLY row this may touch is the caller's own:
 * the update is keyed to session.auth.tenantId and nothing from the request.
 *
 * `platform:workspace:manage` is SENSITIVE (rbac.ts): renaming the company
 * and switching its currency are owner-tier decisions.
 * ========================================================================== */

const CURRENCIES = ["DZD", "EUR", "USD"] as const;

const Body = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(LOCALES as unknown as [string, ...string[]]).optional(),
  currency: z.enum(CURRENCIES).optional(),
  timezone: z
    .string()
    .trim()
    .max(64)
    .refine((tz) => {
      try {
        return (Intl as any).supportedValuesOf("timeZone").includes(tz);
      } catch {
        return false;
      }
    }, "Unknown timezone.")
    .optional(),
});

export const PATCH = tenantRoute("platform:workspace:manage", async ({ req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  if (Object.keys(parsed.data).length === 0) {
    return apiError(422, "INVALID_INPUT", "Send at least one field.");
  }

  const updated = await asPlatform().tenant.update({
    // The caller's own tenant and NOTHING from the request — see the header.
    where: { id: session.auth!.tenantId },
    data: parsed.data,
    select: { id: true, name: true, locale: true, currency: true, timezone: true },
  });
  return apiOk(updated);
});
