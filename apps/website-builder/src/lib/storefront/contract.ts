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
