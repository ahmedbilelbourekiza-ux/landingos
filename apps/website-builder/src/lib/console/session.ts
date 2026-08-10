import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  resolveSession,
  accessibleProducts,
  grantedPermissions,
  type ResolvedSession,
} from "@landingos/auth";

/* =============================================================================
 * Console session access.
 *
 * Auth happens HERE, in a server component, not in middleware. That is the
 * documented consequence of choosing opaque sessions over a stateless JWT
 * (M-09): resolving one needs a database read, and Next's middleware runs on
 * the Edge runtime where there is no database. The architecture accepted that
 * trade when it accepted revocability.
 *
 * It is also not a weaker position than middleware. The layout runs before any
 * console page renders, and every route handler resolves the session itself —
 * a middleware check has never been what actually protects an API.
 * ========================================================================== */

export interface ConsoleSession extends ResolvedSession {
  /** Products this person can actually reach: paid for AND permitted. */
  readonly products: ReturnType<typeof accessibleProducts>;
  /** Every permission held in the active tenant. Drives navigation filtering. */
  readonly permissions: string[];
}

/** Resolve the console session, or null. Never redirects.
 *
 * `cache()` because since UI.6 the session is resolved twice per request —
 * once by the segment layout that draws the shell, once by the page that
 * authorizes itself — and both must see the same answer from one database
 * read. The memo is per-request; nothing outlives it. */
export const getConsoleSession = cache(async (): Promise<ConsoleSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await resolveSession(token);
  if (!session) return null;

  // With no active tenant there is nothing to authorize against yet — the
  // shell sends these people to the tenant picker rather than guessing one.
  const products = session.auth ? accessibleProducts(session.auth) : [];
  const permissions = session.auth ? grantedPermissions(session.auth) : [];

  return { ...session, products, permissions };
});

/**
 * Resolve the session or send the visitor to sign in.
 *
 * `next` carries where they were going, so signing in returns them there
 * instead of dropping them on a generic landing page.
 */
export async function requireConsoleSession(next?: string): Promise<ConsoleSession> {
  const session = await getConsoleSession();
  if (!session) {
    const target = next ? `/console/login?next=${encodeURIComponent(next)}` : "/console/login";
    redirect(target);
  }
  return session;
}
