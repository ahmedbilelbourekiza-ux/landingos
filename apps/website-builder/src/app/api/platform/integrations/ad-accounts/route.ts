import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { sealAccountToken } from "@/lib/ads/meta-ads";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Ad accounts — the platform CRUD (LB.23).
 *
 * The `/integrations/tracking` pattern, applied to the advertising credential:
 * the token is accepted over HTTPS, encrypted IN THIS PROCESS with the app's
 * own `AUTH_SECRET`, stored write-only, and masked to its presence on read.
 * No route ever selects it into a response.
 *
 * WHY THIS MATTERS HERE SPECIFICALLY: the encryption key is derived from
 * `AUTH_SECRET`, and a credential encrypted anywhere else — a laptop, a
 * one-off script with a different environment — is undecryptable by the
 * running app and surfaces as a silent "not connected". Accepting the token
 * through the app is what makes the key correct BY CONSTRUCTION rather than by
 * someone remembering to match two secrets.
 *
 * The token lives on the AdAccount row, per tenant, NOT in the platform-wide
 * PlatformCredential: this route is gated by a TENANT permission, so a global
 * credential behind it would let any tenant's owner overwrite the credential
 * every other tenant depends on.
 *
 * `accountId` is Meta's numeric id WITHOUT the `act_` prefix — the prefix is
 * wire syntax and belongs in the request builder. It is refused rather than
 * stripped, because silently accepting both shapes makes the unique key stop
 * meaning one account.
 * ========================================================================== */

/** Never widen this select to include `accessToken`. The mask below is the
 * second line of defence, not the first. */
const SAFE_SELECT = {
  id: true,
  provider: true,
  accountId: true,
  name: true,
  currency: true,
  isActive: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Presence, never the value — the TrackingIntegration.serverToken rule. */
const withTokenMask = (row: Record<string, unknown>, hasToken: boolean) => ({
  ...row,
  accessToken: hasToken ? "••••••••" : null,
});

export const GET = tenantRoute("platform:integrations:read", async ({ db }) => {
  const rows = await (db as any).adAccount.findMany({
    select: { ...SAFE_SELECT, accessToken: true },
    orderBy: [{ provider: "asc" }, { createdAt: "desc" }],
  });
  const items = rows.map(({ accessToken, ...rest }: any) =>
    withTokenMask(rest, Boolean(accessToken)),
  );
  return apiOk({ items });
});

const Body = z.object({
  // One provider today. An enum rather than a free string so a typo is a 422
  // and not a row nothing will ever read.
  provider: z.literal("meta").default("meta"),
  accountId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "Ad account id should be digits only, without the act_ prefix."),
  name: z.string().trim().min(1).max(120),
  // As the provider bills it. NEVER converted anywhere in this feature.
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Currency should be a 3-letter code, e.g. USD."),
  accessToken: z.string().trim().min(20).max(500).optional(),
  isActive: z.boolean().default(true),
});

export const POST = tenantRoute("platform:integrations:manage", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { accessToken, ...fields } = parsed.data;

  const existing = await (db as any).adAccount.findFirst({
    where: { provider: fields.provider, accountId: fields.accountId },
    select: { id: true },
  });

  /* An UPDATE with no token leaves the stored one alone — re-saving the label
   * must not silently disconnect the account. Clearing a token is a separate,
   * explicit act (DELETE the row), not an accidental side effect of an edit. */
  const data = {
    ...fields,
    ...(accessToken ? { accessToken: sealAccountToken(accessToken) } : {}),
  };

  const row = existing
    ? await (db as any).adAccount.update({
        where: { id: existing.id },
        data,
        select: { ...SAFE_SELECT, accessToken: true },
      })
    : await (db as any).adAccount.create({
        data: { ...data, tenantId: session.auth!.tenantId },
        select: { ...SAFE_SELECT, accessToken: true },
      });

  const { accessToken: stored, ...rest } = row;
  return apiOk(withTokenMask(rest, Boolean(stored)), { status: existing ? 200 : 201 });
});
