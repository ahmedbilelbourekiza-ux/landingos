import "server-only";

import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";

import { requireConsoleSession, type ConsoleSession } from "./session";

/* =============================================================================
 * The guard every product screen needs, in one place.
 *
 * Each screen has to do the same three things before it can render: resolve the
 * session, confirm the tenant is entitled to this product, and load the
 * translator and locale. Repeating that per page is how one screen eventually
 * forgets the entitlement check and quietly renders for a tenant that never
 * bought the product.
 *
 * Product-agnostic: the id is a parameter, so a screen belonging to a tenth
 * product calls this identically.
 *
 * Returns 404 rather than 403 for an unentitled product, matching the API and
 * the shell — confirming a product exists but is unavailable is itself
 * information about what the platform sells and what the tenant has not bought.
 */
export async function requireProduct(productId: string, path: string): Promise<{
  session: ConsoleSession;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}> {
  const session = await requireConsoleSession(path);
  if (!session.products.some((p) => p.id === productId)) notFound();

  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  return { session, locale, t };
}
