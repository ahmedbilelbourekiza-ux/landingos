import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { getAdminWithHash } from "@/lib/auth/require-auth";
import {
  createSession,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth/session";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
    newPassword: z
      .string()
      .min(8, "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل")
      .max(128, "كلمة المرور الجديدة طويلة جداً"),
    confirmPassword: z.string().min(1, "يرجى تأكيد كلمة المرور الجديدة"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "كلمة المرور الجديدة وتأكيدها غير متطابقين",
    path: ["confirmPassword"],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية",
    path: ["newPassword"],
  });

// POST /api/auth/change-password
//
// On success:
//   - bcrypt-hashes the new password
//   - sets mustChangePassword = false (clears the force-change flag)
//   - stamps lastPasswordChangeAt = now
//   - reissues a fresh session JWT so the mustChangePassword claim flips to
//     false in the cookie too (otherwise the middleware/layout would keep
//     redirecting to /dashboard/profile until the cookie expired)
//
// The new password cannot equal the current password (zod refine) and we also
// reject the well-known default password admin123 as the new password even if
// the user somehow set their current password to it — a defence in depth so
// the default credentials can never be re-used after the force-change.
const FORBIDDEN_NEW_PASSWORDS = ["admin123"];

export async function POST(req: NextRequest) {
  try {
    const admin = await getAdminWithHash();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    if (
      FORBIDDEN_NEW_PASSWORDS.some(
        (p) => p.toLowerCase() === parsed.data.newPassword.toLowerCase(),
      )
    ) {
      return fail(
        "WEAK_PASSWORD",
        "لا يمكن استخدام كلمة المرور الافتراضية. اختر كلمة مرور قوية جديدة.",
        400,
      );
    }

    const valid = await bcrypt.compare(
      parsed.data.currentPassword,
      admin.passwordHash,
    );
    if (!valid) {
      return fail("WRONG_PASSWORD", "كلمة المرور الحالية غير صحيحة", 401);
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    const now = new Date();
    await db.admin.update({
      where: { id: admin.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        lastPasswordChangeAt: now,
      },
    });

    // Reissue the session cookie with the flipped mustChangePassword flag.
    const token = await createSession({
      adminId: admin.id,
      username: admin.username,
      mustChangePassword: false,
    });

    const res = NextResponse.json({
      success: true,
      data: {
        mustChangePassword: false,
        lastPasswordChangeAt: now.toISOString(),
      },
    });
    res.cookies.set(
      getSessionCookieName(),
      token,
      getSessionCookieOptions(),
    );
    return res;
  } catch (error) {
    console.error("[api/auth/change-password] error:", error);
    return serverError("Failed to change password");
  }
}
