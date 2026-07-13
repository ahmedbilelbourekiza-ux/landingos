import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { verifySession, getSessionCookieName } from "@/lib/auth/session";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
  newPassword: z.string().min(6, "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل"),
});

// POST /api/auth/change-password
export async function POST(req: NextRequest) {
  try {
    const token = (await cookies()).get(getSessionCookieName())?.value;
    if (!token) return fail("UNAUTHORIZED", "Not authenticated", 401);

    const session = await verifySession(token);
    if (!session) return fail("UNAUTHORIZED", "Session expired", 401);

    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const admin = await db.admin.findUnique({
      where: { id: session.adminId },
    });
    if (!admin) return fail("UNAUTHORIZED", "Admin not found", 401);

    const valid = await bcrypt.compare(parsed.data.currentPassword, admin.passwordHash);
    if (!valid) return fail("WRONG_PASSWORD", "كلمة المرور الحالية غير صحيحة", 401);

    const newHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await db.admin.update({
      where: { id: session.adminId },
      data: { passwordHash: newHash },
    });

    return ok({ success: true });
  } catch (error) {
    console.error("[api/auth/change-password] error:", error);
    return serverError("Failed to change password");
  }
}
