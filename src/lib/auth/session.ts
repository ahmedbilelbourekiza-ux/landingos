import { SignJWT, jwtVerify } from "jose";

// Session token signing + verification. Tokens are HS256-signed JWTs stored in
// an httpOnly cookie. The payload carries the admin id, username, and the
// mustChangePassword flag so the middleware (Edge runtime) can enforce the
// force-change flow without a DB hit on every request.
//
// Secret: AUTH_SECRET from the environment. We fail fast at module load if it
// is missing — no silent fallback to an insecure key.

const SECRET_ENV = process.env.AUTH_SECRET;
if (!SECRET_ENV) {
  throw new Error(
    "AUTH_SECRET is required. Set it in .env (e.g. `openssl rand -base64 32`).",
  );
}
const secret = new TextEncoder().encode(SECRET_ENV);

export const COOKIE_NAME = "admin_session";
export const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days, in seconds

export interface SessionPayload {
  adminId: string;
  username: string;
  mustChangePassword: boolean;
}

export interface SessionClaims {
  adminId: string;
  username: string;
  mustChangePassword: boolean;
}

// Issue a fresh signed JWT for the given admin. Expiration is 7 days from now.
export async function createSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({
    adminId: claims.adminId,
    username: claims.username,
    mustChangePassword: claims.mustChangePassword,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(secret);
}

// Verify a token's signature + expiration. Returns the parsed payload on
// success, or null on any failure (expired, tampered, malformed).
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      adminId: payload.adminId as string,
      username: payload.username as string,
      mustChangePassword: Boolean(payload.mustChangePassword),
    };
  } catch {
    return null;
  }
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export function getSessionDuration() {
  return SESSION_DURATION;
}

// Cookie options used by every route that sets or clears the session cookie.
// Centralised so we never forget a flag. `secure` is on in production only —
// HTTP local dev would otherwise drop the cookie.
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DURATION,
  };
}
