import { redirect } from "next/navigation";

/**
 * The manifest's delivery-prices nav item resolves under the builder's base
 * path, but the screen itself is a PLATFORM settings screen — delivery prices
 * are tenant-wide, not per-product, and the real editor has lived at
 * /console/settings/delivery-prices since Phase 4.4. This nav item pointed at
 * nothing and 404'd for every builder tenant (BUILDER_AUDIT S-02).
 *
 * A redirect rather than a second screen: two editors over one table is two
 * chances to disagree about what a wilaya costs.
 */
export default function BuilderDeliveryPricesRedirect() {
  redirect("/console/settings/delivery-prices");
}
