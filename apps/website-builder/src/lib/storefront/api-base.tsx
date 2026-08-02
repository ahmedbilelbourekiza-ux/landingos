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

const StorefrontApiContext = createContext<string | null>(null);

export function StorefrontApiProvider({
  base,
  children,
}: {
  base: string;
  children: React.ReactNode;
}) {
  return <StorefrontApiContext.Provider value={base}>{children}</StorefrontApiContext.Provider>;
}

/**
 * Build a path against the current storefront base.
 *
 *   const api = useStorefrontApi();
 *   fetch(api("/wilayas"))
 */
export function useStorefrontApi(): (path: string) => string {
  const base = useContext(StorefrontApiContext);
  // Returning a broken URL would produce a 404 that looks like missing data.
  // A storefront with no tenant is a programming error, not an empty state.
  if (!base) {
    throw new Error(
      "useStorefrontApi requires a StorefrontApiProvider — a storefront request has no tenant without one.",
    );
  }
  return (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
