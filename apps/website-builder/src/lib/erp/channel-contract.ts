import "server-only";

/* =============================================================================
 * The sales-channel adapter contract — LP.15, restoring R8.
 *
 * Its own module and not part of `channels.ts`, for the reason
 * `carrier-contract.ts` gives: an adapter implements this contract and the
 * registry imports the adapter, so a contract living in the registry is a
 * circular import. `apps/erp` split it the same way (`lib/platforms/base.js`).
 *
 * -----------------------------------------------------------------------------
 * A CHANNEL IS NOT A CARRIER, AND THE DIFFERENCE DECIDES THE FALLBACK.
 *
 * D-LP.2 made an unregistered CARRIER adapter refuse outright: booking through a
 * fallback fabricated a tracking number, and polling that shipment then settled
 * a delivery outcome for a parcel that never existed. Inventing something is
 * worse than refusing.
 *
 * A channel adapter cannot invent anything. Its two jobs are (a) checking
 * credentials and (b) reading an inbound payload the platform PUSHED, and the
 * legacy's own comment is right: a generic fallback means "the CRM works for any
 * platform out of the box, and gains real API behaviour when an adapter is
 * added". There are nine selectable platforms and two live adapters; refusing
 * the other seven would mean a tenant on JustSell cannot connect a store at all.
 *
 * So the fallback EXISTS and SAYS SO. `structural: true` on a test result, and a
 * message stating that nothing was contacted — the same honesty LP.14 gave the
 * carrier test, and the same reason: a green tick meaning "we did not look" is
 * the lie D-LP.2 removed.
 * ========================================================================== */

/** A channel's stored credentials. Never the masked form — see `maskChannel`. */
export interface ChannelConfig {
  readonly apiUrl: string | null;
  readonly apiKey: string | null;
  readonly apiSecret: string | null;
  readonly webhookSecret: string | null;
}

export interface ChannelTestResult {
  readonly ok: boolean;
  readonly message: string;
}

/** A product a platform holds, normalised. Used by the product webhook (R19). */
export interface ExternalProduct {
  readonly externalId: string;
  readonly name: string;
  /** A decimal STRING. Money never passes through a JS double here (M-06). */
  readonly price: string | null;
  readonly sku: string | null;
  readonly image: string | null;
  readonly variants: readonly { name: string; sku: string | null; price: string | null }[];
}

export interface ChannelAdapter {
  readonly key: string;
  readonly label: string;
  /** False for a platform we can only receive from, never ask. */
  readonly canTest: boolean;

  /**
   * Validate the credentials by asking the platform.
   *
   * OPTIONAL, and its absence is meaningful — the caller falls back to a
   * structural check that says so. Never a write: a test that creates an order
   * to find out whether the API works has created an order.
   */
  testConnection?(cfg: ChannelConfig): Promise<ChannelTestResult>;

  /**
   * Check that an inbound payload really came from this platform.
   *
   * Fails CLOSED. The ERP's Shopify handler returned *accept* when the header
   * was missing, when the secret was unset, and from its own `catch` (SEC-04) —
   * three ways for anybody who knows the URL to inject orders into a tenant's
   * book.
   */
  verifySignature?(
    headers: Headers,
    rawBody: string,
    cfg: ChannelConfig,
  ): "ok" | "missing" | "invalid" | "unsigned-allowed";

  /**
   * Read this platform's own order shape.
   *
   * Returns null when the payload is not an order at all — a topic this adapter
   * does not handle, or a body it does not recognise. The caller decides what a
   * null means; it is not an error.
   */
  parseOrder?(body: Record<string, unknown>, topic?: string | null): Record<string, unknown> | null;

  /** Read this platform's own product shape, for the product webhook (R19). */
  parseProduct?(body: Record<string, unknown>): ExternalProduct | null;
}
