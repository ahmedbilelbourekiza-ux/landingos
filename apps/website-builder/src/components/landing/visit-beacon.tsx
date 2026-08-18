"use client";

import * as React from "react";

import type { SourceEvidenceInput, VisitBodyInput } from "@/lib/storefront/contract";

/* =============================================================================
 * The first-party page-view beacon (AN.1).
 *
 * Mounted by the PUBLIC storefront routes only — the editor's live preview
 * renders the same template and must not look like a customer visit (the
 * ViewContentTracker rule). It takes its endpoint as a PROP because the store
 * home and category pages have no StorefrontApiProvider, and `/api/...` keeps
 * its path shape on a custom domain (LB.45), so one server-built string works
 * on both hosts.
 *
 * WHAT IT CAPTURES, and when. The traffic-source EVIDENCE — utm_source, the
 * platform click ids, a cross-origin referrer — exists only on the session's
 * LANDING URL; one internal navigation later the params are gone and the
 * referrer is the shop itself. So the first page that sees explicit evidence
 * stores it (sessionStorage), every later page reuses it, and the whole
 * session — every view, and the checkout at its end — attributes to the click
 * that opened it. A NEW arrival with explicit evidence (the visitor clicked a
 * second ad) overwrites the stored bundle: attribution follows the latest
 * click, which is every ad platform's own rule.
 *
 * The channel is never computed here — evidence is forwarded and the server
 * derives (lib/storefront/traffic-source.ts), so the mapping stays out of the
 * customer's bundle and out of a spoofable request field.
 * ========================================================================== */

const TOKEN_KEY = "landingos_visit_token";
const SOURCE_KEY = "landingos_visit_source";

function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateToken(): string {
  try {
    const existing = sessionStorage.getItem(TOKEN_KEY);
    if (existing) return existing;
    const token = randomToken();
    sessionStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    // Private-browsing fallback: the view still counts; uniqueness degrades
    // to per-page rather than per-session. Same trade the draft token makes.
    return randomToken();
  }
}

/** The referrer, only when it is another site's. An internal navigation's
 * referrer is this shop, which is evidence of nothing. */
function crossOriginReferrer(): string | null {
  const ref = document.referrer;
  if (!ref) return null;
  try {
    return new URL(ref).origin === window.location.origin ? null : ref;
  } catch {
    return null;
  }
}

function captureOrRecallEvidence(): SourceEvidenceInput | null {
  const params = new URLSearchParams(window.location.search);
  const explicit: SourceEvidenceInput = {
    utmSource: params.get("utm_source"),
    fbclid: params.get("fbclid"),
    ttclid: params.get("ttclid"),
    gclid: params.get("gclid"),
  };
  const hasExplicit = Boolean(
    explicit.utmSource || explicit.fbclid || explicit.ttclid || explicit.gclid,
  );

  try {
    if (hasExplicit) {
      const bundle = { ...explicit, referrer: crossOriginReferrer() };
      sessionStorage.setItem(SOURCE_KEY, JSON.stringify(bundle));
      return bundle;
    }
    const stored = sessionStorage.getItem(SOURCE_KEY);
    if (stored) return JSON.parse(stored) as SourceEvidenceInput;
    // No explicit evidence, nothing stored: the referrer IS the session's
    // evidence (an organic share, a bio link) — store it so it survives the
    // internal navigations that erase it.
    const referrer = crossOriginReferrer();
    const bundle: SourceEvidenceInput = { referrer };
    sessionStorage.setItem(SOURCE_KEY, JSON.stringify(bundle));
    return bundle;
  } catch {
    return hasExplicit ? { ...explicit, referrer: crossOriginReferrer() } : { referrer: crossOriginReferrer() };
  }
}

/** The purchase form reads this at submit time — the same stored bundle the
 * views were attributed with, so an order can never name a different channel
 * than the session that produced it. */
export function readVisitSource(): SourceEvidenceInput | null {
  try {
    const stored = sessionStorage.getItem(SOURCE_KEY);
    return stored ? (JSON.parse(stored) as SourceEvidenceInput) : null;
  } catch {
    return null;
  }
}

export function VisitBeacon({
  endpoint,
  pageKind,
  landingPageId,
}: {
  /** Server-built: `/api/storefront/<slug>/visits`. */
  endpoint: string;
  pageKind: "landing" | "home" | "category";
  landingPageId?: string;
}) {
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    // One beacon per mount. (Dev strict-mode double-invocation is the known
    // exception; production effects run once.)
    if (firedRef.current) return;
    firedRef.current = true;

    const body: VisitBodyInput = {
      token: getOrCreateToken(),
      pageKind,
      landingPageId,
      source: captureOrRecallEvidence() ?? undefined,
    };

    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // Best-effort telemetry: a failed count must never surface to a
      // customer, and never block anything.
    });
  }, [endpoint, pageKind, landingPageId]);

  return null;
}
