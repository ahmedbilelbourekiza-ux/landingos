import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import {
  getAuthenticatedAdmin,
  getAdminWithHash,
} from "@/lib/auth/require-auth";

// GET /api/auth/me — returns the current admin's public profile.
// Public fields only: id, username, mustChangePassword, lastLoginAt,
// lastPasswordChangeAt, createdAt. Never returns passwordHash.
export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

  return ok({
    id: admin.id,
    username: admin.username,
    mustChangePassword: admin.mustChangePassword,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    lastPasswordChangeAt: admin.lastPasswordChangeAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  });
}

const profileSchema = z.object({
  username: z
    .string()
    .min(2, "اسم المستخدم قصير جداً")
    .max(32, "اسم المستخدم طويل جداً")
    .regex(
      /^[a-zA-Z0-9_.-]+$/,
      "اسم المستخدم يجب أن يحتوي على أحرف وأرقام فقط",
    ),
});

// PATCH /api/auth/me — change username. The mustChangePassword flow does NOT
// allow username changes until the password is changed: a user who could
// rename the default admin without changing the password would defeat the
// force-change rule.
export async function PATCH(req: NextRequest) {
  try {
    const admin = await getAdminWithHash();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

    if (admin.mustChangePassword) {
      return fail(
        "MUST_CHANGE_PASSWORD",
        "يجب تغيير كلمة المرور الافتراضية قبل تعديل الحساب",
        403,
      );
    }

    const body = await req.json();
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    if (parsed.data.username !== admin.username) {
      const existing = await db.admin.findFirst({
        where: {
          username: parsed.data.username,
          NOT: { id: admin.id },
        },
      });
      if (existing) return fail("USERNAME_TAKEN", "اسم المستخدم محجوز", 409);

      await db.admin.update({
        where: { id: admin.id },
        data: { username: parsed.data.username },
      });
    }

    return ok({ username: parsed.data.username });
  } catch (error) {
    console.error("[api/auth/me] PATCH error:", error);
    return serverError("Failed to update profile");
  }
}
