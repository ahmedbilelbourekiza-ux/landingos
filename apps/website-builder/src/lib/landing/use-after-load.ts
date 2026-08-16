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

/* -----------------------------------------------------------------------------
 * "May this page spend the visitor's data on images they have not asked for?"
 * (LB.51)
 *
 * Warming is a bet placed with the CUSTOMER's data plan: the gallery
 * neighbour and the first description image together cost real kilobytes on
 * the mobile networks this product sells on. `Save-Data: on` is the visitor
 * saying the bet is not welcome — so every speculative fetch checks HERE,
 * once, rather than each warmer deciding for itself. Explicit requests
 * (tapping a thumbnail, scrolling to an image) are untouched: refusing to
 * SPECULATE is not refusing to SERVE.
 *
 * Effect-gated like the hook above so the server render and first client
 * render agree (`navigator` does not exist on the server); until the effect
 * runs the answer is `false`, which only ever delays warming, never breaks
 * content.
 * -------------------------------------------------------------------------- */
export function useWarmupAllowed(): boolean {
  const ready = useAfterLoad();
  const [saveData, setSaveData] = React.useState(false);
  React.useEffect(() => {
    const conn = (navigator as any).connection;
    if (conn?.saveData === true) setSaveData(true);
  }, []);
  return ready && !saveData;
}
