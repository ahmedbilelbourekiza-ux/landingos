import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { createSession, getSessionCookieName, getSessionDuration } from "@/lib/auth/session";

const loginSchema = z.object({
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const admin = await db.admin.findUnique({
      where: { username: parsed.data.username },
    });

    if (!admin) {
      return fail("INVALID_CREDENTIALS", "اسم المستخدم أو كلمة المرور غير صحيحة", 401);
    }

    const valid = await bcrypt.compare(parsed.data.password, admin.passwordHash);
    if (!valid) {
      return fail("INVALID_CREDENTIALS", "اسم المستخدم أو كلمة المرور غير صحيحة", 401);
    }

    const token = await createSession(admin.id, admin.username);

    const res = NextResponse.json({ success: true, data: { username: admin.username } });
    res.cookies.set(getSessionCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: getSessionDuration(),
      path: "/",
    });

    return res;
  } catch (error) {
    console.error("[api/auth/login] error:", error);
    return serverError("Login failed");
  }
}

import { NextResponse } from "next/server";
