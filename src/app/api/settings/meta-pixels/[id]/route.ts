import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";
import { encryptToken } from "@/lib/meta/crypto";

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  pixelId: z.string().min(1).optional(),
  // Only present when the admin is replacing the token. Omitted = keep the
  // existing encrypted value untouched (we never send the real token back
  // to the browser, so there is nothing to "keep the same" from the client).
  accessToken: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/settings/meta-pixels/[id] — edit label/pixelId/token, or toggle
// isActive on/off. Toggling is intentionally just a PATCH with isActive —
// no separate endpoint — since multiple configs can be active at once.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const existing = await db.metaPixelConfig.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return fail("NOT_FOUND", "Pixel config not found", 404);

    const { accessToken, ...rest } = parsed.data;
    await db.metaPixelConfig.update({
      where: { id },
      data: {
        ...rest,
        ...(accessToken ? { accessToken: encryptToken(accessToken) } : {}),
      },
    });

    return ok({ id });
  } catch (error) {
    console.error("[api/settings/meta-pixels/[id]] PATCH error:", error);
    return serverError("Failed to update pixel config");
  }
}

// DELETE /api/settings/meta-pixels/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const { id } = await params;
    const existing = await db.metaPixelConfig.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return fail("NOT_FOUND", "Pixel config not found", 404);

    await db.metaPixelConfig.delete({ where: { id } });
    return ok({ id });
  } catch (error) {
    console.error("[api/settings/meta-pixels/[id]] DELETE error:", error);
    return serverError("Failed to delete pixel config");
  }
}
