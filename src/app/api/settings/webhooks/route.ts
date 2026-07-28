import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";
import { encryptToken, decryptToken, maskToken } from "@/lib/meta/crypto";
import { WEBHOOK_EVENTS, isWebhookEvent } from "@/lib/webhooks/events";

// GET /api/settings/webhooks — list endpoints with their recent delivery
// history. The signing secret is never returned in full, only a masked
// preview (the admin can regenerate it if they lose it).
export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

    const endpoints = await db.webhookEndpoint.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        deliveries: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            event: true,
            resourceId: true,
            success: true,
            statusCode: true,
            attempts: true,
            error: true,
            createdAt: true,
          },
        },
      },
    });

    const data = endpoints.map((e) => ({
      id: e.id,
      label: e.label,
      url: e.url,
      secretPreview: maskSecret(e.secret),
      events: parseEvents(e.events),
      isActive: e.isActive,
      createdAt: e.createdAt.toISOString(),
      deliveries: e.deliveries.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
    }));

    return ok(data);
  } catch (error) {
    console.error("[api/settings/webhooks] GET error:", error);
    return serverError("Failed to fetch webhook endpoints");
  }
}

function maskSecret(encrypted: string): string {
  try {
    return maskToken(decryptToken(encrypted));
  } catch {
    return "????";
  }
}

function parseEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

const createSchema = z.object({
  label: z.string().min(1, "Label is required"),
  url: z.string().url("Must be a valid URL"),
  // Optional — if omitted we generate a strong secret and return it once.
  secret: z.string().min(16, "Secret must be at least 16 characters").optional(),
  events: z.array(z.string()).default([]),
  isActive: z.boolean().optional(),
});

// POST /api/settings/webhooks — create an endpoint.
//
// If no secret is supplied we generate one and return it IN THE RESPONSE.
// This is the only time the plaintext secret is ever exposed — the admin
// must copy it into their CRM now, because subsequent reads only return a
// masked preview.
export async function POST(req: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);
    if (admin.mustChangePassword) {
      return fail("MUST_CHANGE_PASSWORD", "يجب تغيير كلمة المرور الافتراضية قبل تعديل الإعدادات", 403);
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const invalid = parsed.data.events.filter((e) => !isWebhookEvent(e));
    if (invalid.length > 0) {
      return fail(
        "INVALID_EVENT",
        `Unknown event(s): ${invalid.join(", ")}. Valid events: ${WEBHOOK_EVENTS.join(", ")}`,
        422,
      );
    }

    // URL-safe, 32 bytes of entropy.
    const plaintextSecret = parsed.data.secret ?? randomBytes(24).toString("base64url");

    const created = await db.webhookEndpoint.create({
      data: {
        label: parsed.data.label,
        url: parsed.data.url,
        secret: encryptToken(plaintextSecret),
        events: JSON.stringify(parsed.data.events),
        isActive: parsed.data.isActive ?? false,
      },
      select: { id: true },
    });

    return ok({ id: created.id, secret: plaintextSecret }, 201);
  } catch (error) {
    console.error("[api/settings/webhooks] POST error:", error);
    return serverError("Failed to create webhook endpoint");
  }
}
