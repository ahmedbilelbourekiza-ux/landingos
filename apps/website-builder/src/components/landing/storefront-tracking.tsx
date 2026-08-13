import { resolveBrowserIntegrations } from "@/lib/storefront/tracking";
import { TrackingScripts } from "./tracking-scripts";

/* The one mount every storefront route makes (LB.35).
 *
 * A server component so the integration list is resolved in the same pass that
 * renders the content — the loader has no client fetch to drift from an API
 * shape, which is the mistake the pre-LB.5 loader made.
 *
 * `landingPageId` is what the layout could never supply: with it, a product
 * page fires the pixels linked TO THAT PRODUCT; without it, the store home,
 * a category listing and the thank-you page take the tenant's whole active
 * set, because none of them is a single product. */
export async function StorefrontTracking({
  tenantId,
  landingPageId,
}: {
  tenantId: string;
  landingPageId?: string;
}) {
  const integrations = await resolveBrowserIntegrations(tenantId, landingPageId);
  if (integrations.length === 0) return null;
  return <TrackingScripts integrations={integrations} />;
}
