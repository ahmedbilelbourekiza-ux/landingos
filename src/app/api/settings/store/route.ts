import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";

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

// GET /api/settings/store — returns store settings.
//
// Auth is enforced by the middleware (this route is in the protected matcher).
// The dashboard Settings page reads from here; the storefront reads store
// info directly from Prisma in its server components, so this endpoint does
// not need to be public.
export async function GET() {
  try {
    const settings = await db.storeSettings.findUnique({
      where: { id: "singleton" },
    });
    return ok(settings ?? {});
  } catch (error) {
    console.error("[api/settings/store] GET error:", error);
    return serverError("Failed to fetch settings");
  }
}

// PUT /api/settings/store — update store settings. Requires auth.
// The middleware enforces this at the edge; we re-check here as a defence in
// depth so the route is safe even if the matcher changes.
export async function PUT(req: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

    if (admin.mustChangePassword) {
      return fail(
        "MUST_CHANGE_PASSWORD",
        "يجب تغيير كلمة المرور الافتراضية قبل تعديل الإعدادات",
        403,
      );
    }

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
