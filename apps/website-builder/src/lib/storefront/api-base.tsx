"use client";

import { createContext, useContext } from "react";

/* =============================================================================
 * Where the storefront sends its requests.
 *
 * The same pattern as the editor's BuilderApiProvider, and for the same reason:
 * one component tree, two mounts. The public storefront talks to
 * /api/storefront/<tenant>, while the editor's live preview renders the very
 * same purchase form against the console API — because a preview that fetched
 * the public endpoints would show the customer's view of a DIFFERENT tenant to
 * whoever is editing.
 *
 * There is no sensible default here, unlike the editor's. A storefront request
 * without a tenant has nowhere to go, so the provider is required and the hook
 * says so loudly rather than silently falling back to a legacy path.
 * ========================================================================== */

interface StorefrontBases {
  /** Where API requests go: `/api/storefront/<slug>`. */
  api: string;
  /**
   * Where PAGE navigation goes: `/<slug>` via the path prefix, `""` on a
   * custom domain. The thank-you redirect needs it — a bare
   * `router.push("/thank-you/…")` from a prefixed storefront lands in the
   * platform's root namespace, where `thank-you` is a reserved slug (B-03).
   */
  page: string;
}

const StorefrontApiContext = createContext<StorefrontBases | null>(null);

export function StorefrontApiProvider({
  base,
  pageBase = "",
  children,
}: {
  base: string;
  /** Omit only where page navigation cannot happen (none known today). */
  pageBase?: string;
  children: React.ReactNode;
}) {
  return (
    <StorefrontApiContext.Provider value={{ api: base, page: pageBase }}>
      {children}
    </StorefrontApiContext.Provider>
  );
}

/**
 * Build a path against the current storefront base.
 *
 *   const api = useStorefrontApi();
 *   fetch(api("/wilayas"))
 */
export function useStorefrontApi(): (path: string) => string {
  const bases = useContext(StorefrontApiContext);
  // Returning a broken URL would produce a 404 that looks like missing data.
  // A storefront with no tenant is a programming error, not an empty state.
  if (!bases) {
    throw new Error(
      "useStorefrontApi requires a StorefrontApiProvider — a storefront request has no tenant without one.",
    );
  }
  return (path: string) => `${bases.api}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Build a PAGE href inside the current storefront — `href("/thank-you/x")` is
 * `/acme/thank-you/x` via the path prefix and `/thank-you/x` on a custom
 * domain.
 */
export function useStorefrontHref(): (path: string) => string {
  const bases = useContext(StorefrontApiContext);
  if (!bases) {
    throw new Error(
      "useStorefrontHref requires a StorefrontApiProvider — a storefront link has no tenant without one.",
    );
  }
  return (path: string) => `${bases.page}${path.startsWith("/") ? path : `/${path}`}`;
}
