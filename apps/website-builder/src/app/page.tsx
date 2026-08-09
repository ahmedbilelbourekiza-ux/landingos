import { redirect } from "next/navigation";

import { tenantByDomain } from "@/lib/storefront/resolve-tenant";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The bare domain root.
 *
 * NOTHING OWNED THIS PATH. The URL space is `/{tenant-slug}` for storefronts
 * and `/console/*` for the console, so `https://<host>/` fell through to the
 * 404 page — which is the first thing a person typing the naked domain into a
 * phone saw (reported from production, reproduced with one curl). A front
 * door that answers "not found" is a closed shop.
 *
 * Two doors, decided by how the request arrived:
 *
 *   - A VERIFIED custom domain's root belongs to that tenant's storefront —
 *     their hostname is theirs entirely (the resolve-tenant rule). The full
 *     custom-domain flow is LB.14 roadmap; this keeps the root honest for it.
 *   - Anything else is somebody looking for the platform: the console front
 *     door, which routes a signed-in person to their product and a signed-out
 *     one to login.
 * ========================================================================== */

export default async function Root() {
  const tenant = await tenantByDomain();
  if (tenant) redirect(`/${tenant.slug}`);
  redirect("/console");
}
