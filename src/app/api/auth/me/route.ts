import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { verifySession, getSessionCookieName } from "@/lib/auth/session";

// GET /api/auth/me — returns current admin info
export async function GET() {
  const token = (await cookies()).get(getSessionCookieName())?.value;
  if (!token) return fail("UNAUTHORIZED", "Not authenticated", 401);

  const session = await verifySession(token);
  if (!session) return fail("UNAUTHORIZED", "Session expired", 401);

  const admin = await db.admin.findUnique({
    where: { id: session.adminId },
    select: { id: true, username: true },
  });

  if (!admin) return fail("UNAUTHORIZED", "Admin not found", 401);

  return ok(admin);
}

const profileSchema = z.object({
  username: z.string().min(2, "اسم المستخدم قصير جداً"),
});

// PATCH /api/auth/me — change username
export async function PATCH(req: NextRequest) {
  try {
    const token = (await cookies()).get(getSessionCookieName())?.value;
    if (!token) return fail("UNAUTHORIZED", "Not authenticated", 401);

    const session = await verifySession(token);
    if (!session) return fail("UNAUTHORIZED", "Session expired", 401);

    const body = await req.json();
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    // Check if username is taken by another admin
    const existing = await db.admin.findFirst({
      where: { username: parsed.data.username, NOT: { id: session.adminId } },
    });
    if (existing) return fail("USERNAME_TAKEN", "اسم المستخدم محجوز", 409);

    await db.admin.update({
      where: { id: session.adminId },
      data: { username: parsed.data.username },
    });

    return ok({ username: parsed.data.username });
  } catch (error) {
    console.error("[api/auth/me] PATCH error:", error);
    return serverError("Failed to update profile");
  }
}
