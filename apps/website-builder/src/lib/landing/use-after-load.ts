"use client";

import * as React from "react";

/* =============================================================================
 * "The page has finished loading" as a hook — LB.48.
 *
 * The template's image warming waits for this on purpose. LB.44 measured what
 * eager below-fold images do to the LCP: the first description image's eager
 * fetch ran ALONGSIDE the hero and both got slower. Warming AFTER the window
 * `load` event keeps that lesson — the hero, fonts and CSS have the network to
 * themselves, and the warm fetches begin in the quiet moments before a human
 * can swipe or scroll.
 * ========================================================================== */
export function useAfterLoad(): boolean {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (document.readyState === "complete") {
      setReady(true);
      return;
    }
    const onLoad = () => setReady(true);
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return ready;
}
