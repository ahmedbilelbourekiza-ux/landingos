import { resolveBrowserIntegrations } from "@/lib/storefront/tracking";
import { TrackingScripts, type BrowserIntegration } from "./tracking-scripts";

/* The one mount every storefront route makes (LB.35).
 *
 * A server component so the integration list is resolved in the same pass that
 * renders the content — the loader has no client fetch to drift from an API
 * shape, which is the mistake the pre-LB.5 loader made.
 *
 * `landingPageId` is what the layout could never supply: with it, a product
 * page (or the thank-you page of an order) fires the pixels ticked ON THAT
 * PAGE and nothing else. Without it — the store home, a category listing —
 * no pixel fires at all (PX.1): there is no "every pixel in the store" mode.
 *
 * The loader is mounted EVEN WITH NO PIXELS (PX.1): it is also what stores
 * the ad click id (`fbclid` → `_fbc`) for later. A shopper who lands on the
 * store home from an ad and then opens a product page would otherwise reach
 * the Purchase with their click attribution already gone.
 *
 * `integrations` (LB.51): a caller that already resolved the list inside its
 * own tenant transaction passes it here instead of paying a second
 * transaction for the same two reads — the product page's case. The list must
 * come from `browserIntegrationsFrom` over `activeBrowserIntegrationRows`, the
 * same two functions `resolveBrowserIntegrations` is built from, so both paths
 * answer identically by construction. */
export async function StorefrontTracking({
  tenantId,
  landingPageId,
  integrations,
  relayEndpoint,
}: {
  tenantId: string;
  landingPageId?: string;
  integrations?: BrowserIntegration[];
  /** CAPI.1 — the tenant's `/events` relay. Product pages only: it carries
   *  the server half of ViewContent / AddToCart / InitiateCheckout. */
  relayEndpoint?: string;
}) {
  const list = integrations ?? (await resolveBrowserIntegrations(tenantId, landingPageId));
  return (
    <TrackingScripts
      integrations={list}
      relay={relayEndpoint ? { endpoint: relayEndpoint } : undefined}
    />
  );
}
