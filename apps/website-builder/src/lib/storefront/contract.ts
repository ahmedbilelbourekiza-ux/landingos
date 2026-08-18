import { z } from "zod";

/* =============================================================================
 * The storefront wire contract — ONE vocabulary for the browser and the API.
 *
 * LB.1. Before this module existed the purchase form and the checkout route
 * each held their own copy of the body shape, and the two had drifted apart in
 * every field that was renamed by the platform port: the form sent `landingId`
 * where the route required `landingPageId`, a numeric `baladiaId` where the
 * route required `baladiaName`, and name/value `variants` where the route
 * priced from `variantIds`. Every browser checkout answered 422 while the
 * contract suite — which posts the route's own shape — stayed green.
 *
 * The rule this module enforces is D-LP.3's, applied to a public API: the
 * vocabulary lives in the module that validates it, and every consumer imports
 * it rather than re-declaring it. This file is directive-free ON PURPOSE: the
 * route (server) parses with these schemas and the form (client) builds its
 * body from the same inferred types, so a renamed field breaks the build
 * instead of the customer.
 * ========================================================================== */

/**
 * The traffic-source EVIDENCE bundle (AN.1) — raw browser facts, captured at
 * session start and forwarded verbatim. The channel is derived SERVER-SIDE
 * (`lib/storefront/traffic-source.ts`) on every path that stores one, so the
 * client never carries the mapping and the vocabulary cannot be spoofed into
 * the database — only evidence arrives, bounded like every anonymous input.
 */
export const SourceEvidenceBody = z.object({
  utmSource: z.string().trim().max(200).optional().nullable(),
  fbclid: z.string().trim().max(500).optional().nullable(),
  ttclid: z.string().trim().max(500).optional().nullable(),
  gclid: z.string().trim().max(500).optional().nullable(),
  referrer: z.string().trim().max(500).optional().nullable(),
});

export type SourceEvidenceInput = z.input<typeof SourceEvidenceBody>;

/** POST /api/storefront/[tenant]/orders — the checkout body. */
export const CheckoutBody = z.object({
  landingPageId: z.string().min(1),
  customerName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(6).max(40),
  wilayaId: z.coerce.number().int().positive(),
  baladiaName: z.string().trim().min(1).max(160),
  address: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1000).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(99),
  shippingMethod: z.enum(["HOME", "DESK"]).default("HOME"),
  /** Chosen option ids. What they COST is looked up, never sent. */
  variantIds: z.array(z.string()).max(20).default([]),
  /**
   * The visitor's abandoned-checkout token, when one exists. Lets the server
   * mark the draft converted so a customer who bought stops being chased as a
   * lead. Optional: a visitor whose sessionStorage was unavailable still gets
   * to buy.
   */
  draftToken: z.string().trim().min(8).max(120).optional(),
  /**
   * Ad-attribution identifiers, captured browser-side and used ONLY for
   * server-side conversion events (LB.5). Bounded because they arrive from an
   * anonymous client and are forwarded to third parties. `ttp` and
   * `gaClientId` joined the set in the readiness audit: without them the
   * server-side TikTok event loses its browser identity and the GA4 event
   * cannot join the session that produced it.
   */
  fbc: z.string().trim().max(500).optional(),
  fbp: z.string().trim().max(500).optional(),
  ttclid: z.string().trim().max(500).optional(),
  ttp: z.string().trim().max(500).optional(),
  gaClientId: z.string().trim().max(200).optional(),
  /**
   * AN.1 — the session's traffic-source evidence, as the visit beacon stored
   * it. The route derives the channel and snapshots it onto the order, so
   * "sales by source" needs no join against raw visits. Optional: an order is
   * never refused over missing attribution.
   */
  visitSource: SourceEvidenceBody.optional(),
});

export type CheckoutBodyInput = z.input<typeof CheckoutBody>;

/** What a successful checkout returns inside the platform envelope. */
export interface CheckoutSuccess {
  id: string;
  total: string;
}

/**
 * POST /api/storefront/[tenant]/draft-orders — abandoned-checkout capture.
 *
 * Wilaya and baladia travel as NAMES, not ids: a draft is a lead somebody
 * reads, and storing the name the customer saw keeps it readable without a
 * join — the same snapshot rule SalesOrder follows.
 */
export const DraftBody = z.object({
  token: z.string().trim().min(8).max(120),
  landingPageId: z.string().min(1),
  customerName: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  wilaya: z.string().trim().max(120).optional().nullable(),
  baladia: z.string().trim().max(160).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(99).optional(),
  /** Selected options at capture time, name/value pairs like the order's. */
  variants: z
    .array(z.object({ name: z.string().trim().max(120), value: z.string().trim().max(160) }))
    .max(20)
    .optional(),
  shippingMethod: z.enum(["HOME", "DESK"]).optional(),
  /**
   * Ad-attribution identifiers, exactly as the checkout body carries them.
   * They are NEVER stored on the draft — the route reads them only at the
   * moment the captured phone turns the draft into a Lead event, so the Lead
   * a platform optimises a campaign on carries the click that produced it.
   */
  fbc: z.string().trim().max(500).optional(),
  fbp: z.string().trim().max(500).optional(),
  ttclid: z.string().trim().max(500).optional(),
  ttp: z.string().trim().max(500).optional(),
  gaClientId: z.string().trim().max(200).optional(),
});

export type DraftBodyInput = z.input<typeof DraftBody>;

/**
 * POST /api/storefront/[tenant]/visits — the first-party page-view beacon
 * (AN.1). Fired once per rendered storefront page by a client effect, which
 * is deliberate twice over: crawlers that never execute JS never count, and
 * the count keeps working the day the pages themselves become cacheable
 * (LB.14a.2) — a server-render write would tally cache misses, not visitors.
 * Same tolerance rules as DraftBody: every refusal is a silent 204.
 */
export const VisitBody = z.object({
  /** AN.2 — the LONG-LIVED visitor id (localStorage), not a session token:
   * distinct values in a window are unique visitors. */
  token: z.string().trim().min(8).max(120),
  pageKind: z.enum(["landing", "home", "category"]),
  /** Present exactly when pageKind is "landing". */
  landingPageId: z.string().min(1).optional(),
  source: SourceEvidenceBody.optional(),
  /** AN.2 — true when the visitor id existed before this session began.
   * Client-decided (localStorage outlives the 30-day row retention, so this
   * stays honest past the prune horizon); a strict boolean, so junk fails
   * the parse and the beacon is dropped whole rather than half-recorded. */
  isReturning: z.boolean().optional().default(false),
});

export type VisitBodyInput = z.input<typeof VisitBody>;

/** One destination row from GET /api/storefront/[tenant]/wilayas. */
export interface WilayaItem {
  id: number;
  code: string;
  name: string;
  nameAr: string | null;
  baladias: { id: number; name: string; nameAr: string | null }[];
  /** Decimal strings — a price never passes through a JS float (M-06). */
  homePrice: string;
  deskPrice: string | null;
}
