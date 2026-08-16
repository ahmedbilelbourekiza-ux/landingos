import { resolveBrowserIntegrations } from "@/lib/storefront/tracking";
import { TrackingScripts, type BrowserIntegration } from "./tracking-scripts";

/* The one mount every storefront route makes (LB.35).
 *
 * A server component so the integration list is resolved in the same pass that
 * renders the content — the loader has no client fetch to drift from an API
 * shape, which is the mistake the pre-LB.5 loader made.
 *
 * `landingPageId` is what the layout could never supply: with it, a product
 * page fires the pixels linked TO THAT PRODUCT; without it, the store home,
 * a category listing and the thank-you page take the tenant's whole active
 * set, because none of them is a single product.
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
}: {
  tenantId: string;
  landingPageId?: string;
  integrations?: BrowserIntegration[];
}) {
  const list = integrations ?? (await resolveBrowserIntegrations(tenantId, landingPageId));
  if (list.length === 0) return null;
  return <TrackingScripts integrations={list} />;
}
