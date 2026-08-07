"use client";

import * as React from "react";
import { useStorefrontApi } from "@/lib/storefront/api-base";
import type { DraftBodyInput } from "@/lib/storefront/contract";

// Abandoned-checkout capture for the storefront purchase form.
//
// Progressively saves whatever the visitor has typed so a phone number is
// recovered even if they never press the buy button. Two safety nets:
//
//   1. Debounced save (2s after they stop typing) — catches the common case
//      of someone filling the form then wandering off.
//   2. A final flush via navigator.sendBeacon on pagehide/visibilitychange —
//      catches someone who closes the tab mid-typing, before the debounce
//      fires. sendBeacon is used because a normal fetch is killed when the
//      page unloads, whereas the browser guarantees a beacon is delivered.
//
// The token is per-visit (sessionStorage), scoped to the landing page, so
// every update replaces one row rather than creating a new lead per keystroke.

const DEBOUNCE_MS = 2000;

function getOrCreateToken(landingId: string): string {
  const key = `landingos_draft_${landingId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(key, token);
    return token;
  } catch {
    // sessionStorage can throw in private-browsing modes. Fall back to an
    // in-memory token: capture still works for this page view.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

// Names, not ids: the server stores the draft as a readable lead (the same
// snapshot rule SalesOrder follows), and the contract module is the one
// vocabulary both sides use (B-04).
export interface DraftSnapshot {
  customerName?: string | null;
  phone?: string | null;
  wilaya?: string | null;
  baladia?: string | null;
  quantity?: number;
  variants?: { name: string; value: string }[];
  shippingMethod?: "HOME" | "DESK" | null;
}

// Only bother the server once there is something worth saving. Mirrors the
// server's own rule so we do not fire pointless requests on an empty form.
function isWorthSaving(snapshot: DraftSnapshot): boolean {
  const digits = (snapshot.phone ?? "").replace(/\D/g, "");
  const name = (snapshot.customerName ?? "").trim();
  return digits.length >= 6 || name.length >= 2;
}

export function useDraftCapture(landingId: string) {
  // Bound to this storefront tenant.
  const api = useStorefrontApi();
  // useState (not a ref) because the token is part of this hook's public
  // return value, so it is read during render by the consuming form. The
  // lazy initializer runs once per mount; the window guard keeps it from
  // touching sessionStorage during server rendering.
  const [token] = React.useState<string | null>(() =>
    typeof window === "undefined" ? null : getOrCreateToken(landingId),
  );

  const latestRef = React.useRef<DraftSnapshot>({});
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = React.useRef<string>("");
  const convertedRef = React.useRef(false);

  const buildBody = React.useCallback(
    (snapshot: DraftSnapshot) => {
      const body: DraftBodyInput = {
        token: token ?? "",
        landingPageId: landingId,
        customerName: snapshot.customerName || null,
        phone: snapshot.phone || null,
        wilaya: snapshot.wilaya || null,
        baladia: snapshot.baladia || null,
        quantity: snapshot.quantity ?? 1,
        variants: snapshot.variants ?? [],
        shippingMethod: snapshot.shippingMethod ?? undefined,
      };
      return JSON.stringify(body);
    },
    [landingId, token],
  );

  const send = React.useCallback(
    (snapshot: DraftSnapshot, useBeacon: boolean) => {
      if (convertedRef.current) return;
      if (!token) return;
      if (!isWorthSaving(snapshot)) return;

      const body = buildBody(snapshot);
      // Skip if nothing actually changed since the last save.
      if (body === lastSentRef.current) return;
      lastSentRef.current = body;

      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          api("/draft-orders"),
          new Blob([body], { type: "application/json" }),
        );
        return;
      }

      void fetch(api("/draft-orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        // Capture is best-effort — never surface an error to the customer,
        // and never block them from completing their order.
      });
    },
    [buildBody, token],
  );

  // Called by the form whenever a field changes.
  const update = React.useCallback(
    (snapshot: DraftSnapshot) => {
      latestRef.current = snapshot;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => send(latestRef.current, false), DEBOUNCE_MS);
    },
    [send],
  );

  // Called after a successful order so the pagehide flush does not resurrect
  // a lead the customer already converted.
  const markConverted = React.useCallback(() => {
    convertedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  React.useEffect(() => {
    const flush = () => send(latestRef.current, true);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [send]);

  return { update, markConverted, token };
}
