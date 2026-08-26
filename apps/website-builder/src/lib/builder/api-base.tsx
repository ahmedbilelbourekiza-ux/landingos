"use client";

import { createContext, useCallback, useContext } from "react";

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
 *
 * REFERENTIALLY STABLE, and that is a load-bearing contract, not a nicety.
 * Seventeen editor components hold this function in `useCallback`/`useEffect`
 * dependency arrays. The original unmemoized closure was a NEW identity on
 * every render, which voided every one of those arrays — and in the version
 * history dialog it closed a self-sustaining loop: effect → fetch → setState →
 * render → new `api` → new `load` → effect again, forever. One click on
 * "Version history" measured 23+ requests in 8 seconds, flickering
 * loading↔ready the whole time (the bug shipped 20 Aug with LB.14b and was
 * reported live by the merchant 26 Aug). The dialog was the one consumer
 * whose effect both depended on this identity AND set state, but every
 * consumer was paying for the broken contract in silent extra work.
 */
export function useBuilderApi(): (path: string) => string {
  const base = useContext(BuilderApiContext);
  return useCallback(
    (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`,
    [base],
  );
}
