import { NextResponse } from "next/server";
import {
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth/session";
import { ok } from "@/lib/api-response";

// POST /api/auth/logout — clears the session cookie.
// We set the cookie to an empty value with maxAge=0 in addition to delete()
// so the cookie is reliably removed across browsers and proxies.
export async function POST() {
  const res = NextResponse.json(ok({}));
  const opts = getSessionCookieOptions();
  res.cookies.set(getSessionCookieName(), "", {
    ...opts,
    maxAge: 0,
  });
  return res;
}
