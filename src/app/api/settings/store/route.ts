import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { verifySession, getSessionCookieName } from "@/lib/auth/session";

const storeSettingsSchema = z.object({
  storeName: z.string().optional(),
  storeDescription: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  favicon: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  facebook: z.string().optional().nullable(),
  instagram: z.string().optional().nullable(),
  tiktok: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  telegram: z.string().optional().nullable(),
});

// GET /api/settings/store — returns store settings
export async function GET() {
  try {
    const settings = await db.storeSettings.findUnique({ where: { id: "singleton" } });
    return ok(settings ?? {});
  } catch (error) {
    console.error("[api/settings/store] GET error:", error);
    return serverError("Failed to fetch settings");
  }
}

// PUT /api/settings/store — update store settings
export async function PUT(req: NextRequest) {
  try {
    const token = (await cookies()).get(getSessionCookieName())?.value;
    if (!token) return fail("UNAUTHORIZED", "Not authenticated", 401);
    const session = await verifySession(token);
    if (!session) return fail("UNAUTHORIZED", "Session expired", 401);

    const body = await req.json();
    const parsed = storeSettingsSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const updated = await db.storeSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...parsed.data },
      update: parsed.data,
    });

    return ok(updated);
  } catch (error) {
    console.error("[api/settings/store] PUT error:", error);
    return serverError("Failed to update settings");
  }
}
