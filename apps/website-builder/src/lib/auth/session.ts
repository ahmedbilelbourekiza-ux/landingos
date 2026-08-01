import { SignJWT, jwtVerify } from "jose";

// Session token signing + verification. Tokens are HS256-signed JWTs stored in
// an httpOnly cookie. The payload carries the admin id, username, and the
// mustChangePassword flag so the middleware (Edge runtime) can enforce the
// force-change flow without a DB hit on every request.
//
// CRITICAL: this module is imported by the middleware (Edge runtime), which
// runs before any route handler. Throwing at module-evaluation time would
// crash the entire Next.js process at bootstrap. We therefore MUST NOT throw
// at the top level. The AUTH_SECRET is resolved lazily inside the JWT
// helpers via getAuthSecret(), which only throws when a JWT operation is
// actually attempted. This keeps the module safe to import from anywhere,
// including the middleware bootstrap path.

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

// Error class used when AUTH_SECRET is missing or empty. The message includes
// actionable instructions so a developer seeing it in the server log knows
// exactly what to do.
export class AuthSecretMissingError extends Error {
  constructor() {
    const hint =
      process.env.NODE_ENV === "production"
        ? "Set the AUTH_SECRET environment variable to a random 32+ byte string."
        : "Set AUTH_SECRET in your .env file. Generate one with:  openssl rand -base64 32";
    super(`AUTH_SECRET is required. ${hint}`);
    this.name = "AuthSecretMissingError";
  }
}

// Lazy secret resolver. Reads process.env.AUTH_SECRET on every call (cheap)
// and throws AuthSecretMissingError only when a JWT operation is actually
// attempted. This means:
//   - Importing this module never throws (middleware bootstrap is safe).
//   - Middleware that finds no session cookie never needs the secret.
//   - Routes that need to sign/verify call this and can catch the typed error
//     to return a clear 500 instead of crashing the process.
export function getAuthSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.trim() === "") {
    throw new AuthSecretMissingError();
  }
  return new TextEncoder().encode(raw);
}

// Issue a fresh signed JWT for the given admin. Expiration is 7 days from now.
// Throws AuthSecretMissingError if AUTH_SECRET is not configured — callers
// should catch and convert to a 500 response.
export async function createSession(claims: SessionClaims): Promise<string> {
  const secret = getAuthSecret();
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
// success, or null on any failure (expired, tampered, malformed, or
// AUTH_SECRET missing). We swallow AuthSecretMissingError here because the
// middleware calls this on every request — a missing secret should not log
// a stack trace per request; it should simply treat the session as invalid
// and let the route handler return the appropriate auth error.
export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const secret = getAuthSecret();
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
