"use client";

import { createContext, useContext } from "react";

/* =============================================================================
 * Where the editor sends its requests.
 *
 * The landing editor is 54 components and ~5,000 lines, and it is genuinely
 * good. Porting it therefore means MOVING it, not rewriting it — the only
 * thing that actually changes is which API it talks to.
 *
 * A context rather than a find-and-replace, because both copies have to work
 * at once during the migration: the legacy dashboard keeps talking to
 * /api/landings under its JWT, and the console talks to /api/builder/landings
 * under the platform session. One component tree, two mounts, no duplication.
 *
 * The default is the LEGACY path deliberately. A component that has not been
 * told otherwise behaves exactly as it did before, so mounting the editor in
 * the console is an addition rather than an edit to something already working.
 *
 * When the legacy dashboard is retired this collapses to a constant, and the
 * provider disappears with it.
 * ========================================================================== */

const BuilderApiContext = createContext<string>("/api");

export function BuilderApiProvider({
  base,
  children,
}: {
  base: string;
  children: React.ReactNode;
}) {
  return <BuilderApiContext.Provider value={base}>{children}</BuilderApiContext.Provider>;
}

/**
 * Build a path against the current base.
 *
 *   const api = useBuilderApi();
 *   fetch(api(`/landings/${id}/pricing`), ...)
 */
export function useBuilderApi(): (path: string) => string {
  const base = useContext(BuilderApiContext);
  return (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
