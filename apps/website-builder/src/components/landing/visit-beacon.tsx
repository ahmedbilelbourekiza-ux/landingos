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

/** AN.2 — LOCALSTORAGE, not sessionStorage: the id must outlive the visit so
 * distinct ids are unique VISITORS and a customer coming back next week reads
 * as returning. Random and meaningless; first-party; single shop. */
const VISITOR_ID_KEY = "landingos_visitor_id";
/** Session-scoped verdict of "had we seen this visitor before THIS session
 * started" — decided once at session start, then stable, so a returning
 * customer's tenth page this session does not read as ten returns. */
const RETURNING_KEY = "landingos_visit_returning";
const SOURCE_KEY = "landingos_visit_source";

function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function visitorIdentity(): { id: string; isReturning: boolean } {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    const id = existing ?? randomToken();
    if (!existing) localStorage.setItem(VISITOR_ID_KEY, id);

    // The verdict is per SESSION: sessionStorage empty means a session is
    // just beginning, and "returning" is exactly "the id predates it".
    const decided = sessionStorage.getItem(RETURNING_KEY);
    if (decided !== null) return { id, isReturning: decided === "1" };
    const isReturning = Boolean(existing);
    sessionStorage.setItem(RETURNING_KEY, isReturning ? "1" : "0");
    return { id, isReturning };
  } catch {
    // Private-browsing fallback: the view still counts; uniqueness degrades
    // to per-page and the visitor reads as new. Same trade the draft token
    // makes.
    return { id: randomToken(), isReturning: false };
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

/* =============================================================================
 * BH.1 — the in-page behavior collector.
 *
 * Lives in the beacon's module so ONE place owns the view id: the arrival
 * beacon creates the row carrying `viewId`, the collector flushes onto that
 * row, and no second identity scheme can drift from the first.
 *
 * It arms ONLY when the page opted in (per-page, default off — the server
 * enforces it again). Unarmed, every record* call below is a property check
 * and a return: the template's sections call them unconditionally, and that
 * must cost nothing on the 99% of views with no tracking.
 *
 * Capture discipline (the constraints JS.1/LB.44/LB.49 are built on):
 * nothing before first paint — arming happens inside the beacon's own
 * effect; the section observer is ONE IntersectionObserver (passive by
 * nature); every interaction signal piggybacks an existing handler; and the
 * flush is the draft capture's exact exit mechanism (sendBeacon on
 * pagehide / visibility-hidden, change-deduped so a tab-switch flush
 * followed by more interaction still lands a final, fuller update —
 * counters are monotonic, so a later flush only ever knows more).
 * ========================================================================== */

interface BehaviorState {
  endpoint: string;
  viewId: string;
  furthestRank: number;
  sawForm: boolean;
  galleryChanges: number;
  galleryDeepestIndex: number;
  faqOpens: number;
  faqOpenedIds: string[];
  variantChanges: number;
  stickyBuyClicked: boolean;
  whatsappClicked: boolean;
  /** Visible-time bookkeeping: accumulated ms + when the current visible
   * stretch began (null while hidden). */
  accumulatedMs: number;
  visibleSince: number | null;
  lastSent: string;
}

let behavior: BehaviorState | null = null;

/** The landmark vocabulary, deepest-last — mirrors BH_SECTIONS in the
 * contract (not imported: this file must stay in the customer bundle's
 * budget, and the array is five words). */
const SECTION_RANKS: Record<string, number> = {
  hero: 1,
  description: 2,
  reviews: 3,
  faq: 4,
  footer: 5,
};
const SECTION_NAMES = ["hero", "description", "reviews", "faq", "footer"];

export function recordGalleryChange(index: number) {
  if (!behavior) return;
  behavior.galleryChanges += 1;
  if (index > behavior.galleryDeepestIndex) behavior.galleryDeepestIndex = index;
}

export function recordFaqOpen(id: string) {
  if (!behavior) return;
  behavior.faqOpens += 1;
  if (!behavior.faqOpenedIds.includes(id) && behavior.faqOpenedIds.length < 20) {
    behavior.faqOpenedIds.push(id);
  }
}

export function recordVariantChange() {
  if (behavior) behavior.variantChanges += 1;
}

export function recordStickyBuyClick() {
  if (behavior) behavior.stickyBuyClicked = true;
}

function behaviorFlush() {
  if (!behavior) return;
  const b = behavior;
  const now = Date.now();
  if (b.visibleSince !== null) {
    b.accumulatedMs += now - b.visibleSince;
    b.visibleSince = document.visibilityState === "visible" ? now : null;
  }

  const body = JSON.stringify({
    viewId: b.viewId,
    furthestSection: b.furthestRank > 0 ? SECTION_NAMES[b.furthestRank - 1] : undefined,
    sawForm: b.sawForm || undefined,
    galleryChanges: b.galleryChanges || undefined,
    galleryDeepestIndex: b.galleryChanges > 0 ? b.galleryDeepestIndex : undefined,
    faqOpens: b.faqOpens || undefined,
    faqOpenedIds: b.faqOpenedIds.length > 0 ? b.faqOpenedIds : undefined,
    variantChanges: b.variantChanges || undefined,
    stickyBuyClicked: b.stickyBuyClicked || undefined,
    whatsappClicked: b.whatsappClicked || undefined,
    // Always present when armed — the aggregates' "measured" marker.
    activeMs: Math.min(b.accumulatedMs, 86_400_000),
  });
  if (body === b.lastSent) return;
  b.lastSent = body;

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(b.endpoint, new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch(b.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

/** Arm the collector for this view. Returns the teardown. */
function armBehavior(endpoint: string, viewId: string): () => void {
  behavior = {
    endpoint,
    viewId,
    furthestRank: 0,
    sawForm: false,
    galleryChanges: 0,
    galleryDeepestIndex: 0,
    faqOpens: 0,
    faqOpenedIds: [],
    variantChanges: 0,
    stickyBuyClicked: false,
    whatsappClicked: false,
    accumulatedMs: 0,
    visibleSince: document.visibilityState === "visible" ? Date.now() : null,
    lastSent: "",
  };

  // ONE observer over the section landmarks the template already renders,
  // plus the buy button (`sawForm` — the sticky bar's own "form seen"
  // element). threshold 0.1: "meaningfully entered", tolerant of sections
  // taller than a phone viewport.
  const observer = new IntersectionObserver(
    (entries) => {
      const b = behavior;
      if (!b) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const section = (entry.target as HTMLElement).dataset.bhSection;
        if (section) {
          const rank = SECTION_RANKS[section] ?? 0;
          if (rank > b.furthestRank) b.furthestRank = rank;
        }
        if ((entry.target as HTMLElement).matches('button[type="submit"]')) {
          b.sawForm = true;
        }
      }
    },
    { threshold: 0.1 },
  );
  for (const el of document.querySelectorAll<HTMLElement>("[data-bh-section]")) {
    observer.observe(el);
  }
  const cta = document.querySelector<HTMLElement>('button[type="submit"]');
  if (cta) observer.observe(cta);

  const onVisibility = () => {
    const b = behavior;
    if (!b) return;
    if (document.visibilityState === "hidden") {
      if (b.visibleSince !== null) {
        b.accumulatedMs += Date.now() - b.visibleSince;
        b.visibleSince = null;
      }
      behaviorFlush();
    } else if (b.visibleSince === null) {
      b.visibleSince = Date.now();
    }
  };

  // The WhatsApp button is a SERVER component (a static anchor) and stays
  // one — a delegated listener here costs nothing on the 99% of pages where
  // the collector never arms, instead of a client boundary on every page.
  const onClick = (event: MouseEvent) => {
    const b = behavior;
    if (!b) return;
    if ((event.target as Element | null)?.closest?.('[data-testid="floating-whatsapp"]')) {
      b.whatsappClicked = true;
    }
  };

  window.addEventListener("pagehide", behaviorFlush);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("click", onClick, { capture: true, passive: true });

  return () => {
    behaviorFlush();
    observer.disconnect();
    window.removeEventListener("pagehide", behaviorFlush);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("click", onClick, { capture: true });
    behavior = null;
  };
}

export function VisitBeacon({
  endpoint,
  pageKind,
  landingPageId,
  collectBehavior = false,
}: {
  /** Server-built: `/api/storefront/<slug>/visits`. */
  endpoint: string;
  pageKind: "landing" | "home" | "category";
  landingPageId?: string;
  /** BH.1 — true only on a landing page whose merchant opted it in. The
   * server enforces the opt-in again; this flag only decides whether any
   * client work happens at all. */
  collectBehavior?: boolean;
}) {
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    // One beacon per mount. (Dev strict-mode double-invocation is the known
    // exception; production effects run once.)
    if (firedRef.current) return;
    firedRef.current = true;

    const { id, isReturning } = visitorIdentity();
    const viewId = randomToken();
    const body: VisitBodyInput = {
      token: id,
      pageKind,
      landingPageId,
      source: captureOrRecallEvidence() ?? undefined,
      isReturning,
      viewId,
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

    if (collectBehavior && pageKind === "landing") {
      return armBehavior(`${endpoint}/behavior`, viewId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, pageKind, landingPageId, collectBehavior]);

  return null;
}
