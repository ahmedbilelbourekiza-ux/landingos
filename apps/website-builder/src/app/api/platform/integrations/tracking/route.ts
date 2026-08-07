import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { encryptToken } from "@/lib/meta/crypto";
import { trackingProvider, TRACKING_PROVIDER_IDS } from "@/lib/tracking/config";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Tracking integrations — the platform CRUD (LB.5).
 *
 * A PLATFORM surface like webhooks: a tenant with ten products tracks once.
 * `serverToken` is encrypted at rest and write-only; the list masks it to its
 * presence. Validation is per provider, from the same catalogue the console
 * renders — a GA4 id pasted into a Meta row is refused by name, because the
 * failure otherwise is silent: events fire at a pixel that does not exist.
 * ========================================================================== */

const mask = (row: any) => ({
  ...row,
  serverToken: row.serverToken ? "••••••••" : null,
});

export const GET = tenantRoute("platform:integrations:read", async ({ db }) => {
  const items = await (db as any).trackingIntegration.findMany({
    orderBy: [{ provider: "asc" }, { createdAt: "desc" }],
  });
  return apiOk({ items: items.map(mask) });
});

const Body = z.object({
  provider: z.enum(TRACKING_PROVIDER_IDS as [string, ...string[]]),
  label: z.string().trim().min(1).max(120),
  publicId: z.string().trim().min(1).max(120),
  serverToken: z.string().trim().min(4).max(500).optional(),
  testCode: z.string().trim().max(80).optional(),
  settings: z.record(z.string(), z.string().trim().max(200)).default({}),
  managedBy: z.enum(["customer", "platform"]).default("customer"),
  isActive: z.boolean().default(true),
});

export const POST = tenantRoute("platform:integrations:manage", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  const spec = trackingProvider(parsed.data.provider)!;
  if (!spec.publicIdPattern.test(parsed.data.publicId)) {
    return apiError(
      422,
      "INVALID_PUBLIC_ID",
      `${spec.publicIdLabel} for ${spec.name} should look like: ${spec.publicIdHint}.`,
    );
  }
  if (parsed.data.serverToken && !spec.serverTokenLabel) {
    return apiError(422, "NO_SERVER_SIDE", `${spec.name} has no server-side credential — remove the token.`);
  }
  for (const field of spec.settingsFields) {
    if (field.required && !parsed.data.settings[field.key]?.trim()) {
      return apiError(422, "MISSING_SETTING", `${spec.name} needs "${field.label}".`);
    }
  }

  const created = await (db as any).trackingIntegration.create({
    data: {
      ...parsed.data,
      serverToken: parsed.data.serverToken ? encryptToken(parsed.data.serverToken) : null,
      tenantId: session.auth!.tenantId,
    },
  });
  return apiOk(mask(created), { status: 201 });
});
