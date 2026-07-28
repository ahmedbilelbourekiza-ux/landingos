import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";
import { encryptToken } from "@/lib/meta/crypto";
import { WEBHOOK_EVENTS, isWebhookEvent } from "@/lib/webhooks/events";

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  url: z.string().url().optional(),
  // Omitted = keep the existing secret. The plaintext is never sent back to
  // the browser, so there is nothing for the client to round-trip.
  secret: z.string().min(16).optional(),
  events: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/settings/webhooks/[id] — edit an endpoint, change its event
// subscriptions, or toggle it active.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);
    if (admin.mustChangePassword) {
      return fail("MUST_CHANGE_PASSWORD", "يجب تغيير كلمة المرور الافتراضية قبل تعديل الإعدادات", 403);
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const existing = await db.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return fail("NOT_FOUND", "Webhook endpoint not found", 404);

    if (parsed.data.events) {
      const invalid = parsed.data.events.filter((e) => !isWebhookEvent(e));
      if (invalid.length > 0) {
        return fail(
          "INVALID_EVENT",
          `Unknown event(s): ${invalid.join(", ")}. Valid events: ${WEBHOOK_EVENTS.join(", ")}`,
          422,
        );
      }
    }

    const { secret, events, ...rest } = parsed.data;
    await db.webhookEndpoint.update({
      where: { id },
      data: {
        ...rest,
        ...(secret ? { secret: encryptToken(secret) } : {}),
        ...(events ? { events: JSON.stringify(events) } : {}),
      },
    });

    return ok({ id });
  } catch (error) {
    console.error("[api/settings/webhooks/[id]] PATCH error:", error);
    return serverError("Failed to update webhook endpoint");
  }
}

// DELETE /api/settings/webhooks/[id] — delivery logs cascade with it.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);
    if (admin.mustChangePassword) {
      return fail("MUST_CHANGE_PASSWORD", "يجب تغيير كلمة المرور الافتراضية قبل تعديل الإعدادات", 403);
    }

    const { id } = await params;
    const existing = await db.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return fail("NOT_FOUND", "Webhook endpoint not found", 404);

    await db.webhookEndpoint.delete({ where: { id } });
    return ok({ id });
  } catch (error) {
    console.error("[api/settings/webhooks/[id]] DELETE error:", error);
    return serverError("Failed to delete webhook endpoint");
  }
}
