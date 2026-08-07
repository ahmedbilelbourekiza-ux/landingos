import { z } from "zod";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { encryptToken } from "@/lib/meta/crypto";

export const dynamic = "force-dynamic";

/**
 * Outgoing webhook endpoints.
 *
 * A PLATFORM surface, not a product one. Under S-10 this stopped being private
 * plumbing between the builder and the ERP and became the tenant-facing
 * integration feature — the thing a customer uses to push their own events to
 * their own tools. A tenant with ten products still configures webhooks once.
 *
 * The permission is `platform:integrations:*`, which resolves to no product and
 * is therefore not entitlement-gated: a tenant can wire up integrations
 * whatever they subscribe to.
 */
const mask = (row: any) => ({ ...row, secret: row.secret ? "••••••••" : null });

export const GET = tenantRoute("platform:integrations:read", async ({ db }) => {
  const items = await (db as any).webhookEndpoint.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { deliveries: true } } },
  });
  // The signing secret is write-only: it is needed to sign, never to display.
  return apiOk({ items: items.map(mask) });
});

const Body = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2000),
  secret: z.string().trim().min(8).max(200),
  events: z.array(z.string().trim().max(80)).max(50).default([]),
  isActive: z.boolean().default(false),
});

export const POST = tenantRoute("platform:integrations:manage", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");

  // http:// would send a signed payload containing customer data in clear text.
  if (!parsed.data.url.startsWith("https://")) {
    return apiError(422, "INSECURE_URL", "A webhook endpoint must use https.");
  }

  const created = await (db as any).webhookEndpoint.create({
    // Encrypted at rest, as the schema has always claimed. The port stored it
    // in plaintext while the delivery layer decrypted — so signing failed on
    // every row this route ever wrote (BUILDER_AUDIT, LB.3).
    data: {
      ...parsed.data,
      secret: encryptToken(parsed.data.secret),
      tenantId: session.auth!.tenantId,
    },
  });
  return apiOk(mask(created), { status: 201 });
});
