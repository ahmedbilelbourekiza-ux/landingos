import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import {
  createSession,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth/session";
import {
  resolveClientIp,
  recordFailedAttempt,
  checkRateLimit,
  clearAttempts,
} from "@/lib/auth/rate-limit";

const loginSchema = z.object({
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

// POST /api/auth/login
//
// Flow:
//   1. Rate-limit check (per IP). 5 failures / 5 minutes → 429.
//   2. Validate body.
//   3. Look up admin. Record a failed attempt on miss (so an attacker can't
//      probe usernames without hitting the limit).
//   4. bcrypt compare. Record a failed attempt on mismatch.
//   5. On success: clear the IP's attempts, stamp lastLoginAt, issue a fresh
//      signed JWT cookie carrying the mustChangePassword flag.
//   6. Return the admin's public fields. The client decides where to redirect
//      based on mustChangePassword.
export async function POST(req: NextRequest) {
  try {
    const ip = resolveClientIp(req);

    // Short-circuit if the IP is already over the limit.
    const preCheck = checkRateLimit(ip);
    if (!preCheck.ok) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message:
              "تم تجاوز عدد محاولات تسجيل الدخول، حاول مرة أخرى بعد عدة دقائق.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(preCheck.retryAfterSeconds) },
        },
      );
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const admin = await db.admin.findUnique({
      where: { username: parsed.data.username },
    });

    if (!admin) {
      const result = recordFailedAttempt(ip);
      return fail(
        "INVALID_CREDENTIALS",
        "اسم المستخدم أو كلمة المرور غير صحيحة",
        401,
        { attemptsRemaining: result.attemptsRemaining },
      );
    }

    const valid = await bcrypt.compare(parsed.data.password, admin.passwordHash);
    if (!valid) {
      const result = recordFailedAttempt(ip);
      return fail(
        "INVALID_CREDENTIALS",
        "اسم المستخدم أو كلمة المرور غير صحيحة",
        401,
        { attemptsRemaining: result.attemptsRemaining },
      );
    }

    // Success — clear the IP's failure history so a user who got in after a
    // few typos isn't penalised on their next session.
    clearAttempts(ip);

    // Stamp lastLoginAt. We use updateMany to avoid touching updatedAt (which
    // @updatedAt manages automatically and would also bump). Actually Prisma's
    // @updatedAt only fires when other fields change, so a plain update is fine.
    await db.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await createSession({
      adminId: admin.id,
      username: admin.username,
      mustChangePassword: admin.mustChangePassword,
    });

    const res = NextResponse.json({
      success: true,
      data: {
        username: admin.username,
        mustChangePassword: admin.mustChangePassword,
      },
    });
    res.cookies.set(
      getSessionCookieName(),
      token,
      getSessionCookieOptions(),
    );
    return res;
  } catch (error) {
    console.error("[api/auth/login] error:", error);
    return serverError("Login failed");
  }
}
