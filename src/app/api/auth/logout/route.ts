import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/auth/session";
import { ok } from "@/lib/api-response";

export async function POST() {
  const res = NextResponse.json(ok({}));
  res.cookies.delete(getSessionCookieName());
  return res;
}
