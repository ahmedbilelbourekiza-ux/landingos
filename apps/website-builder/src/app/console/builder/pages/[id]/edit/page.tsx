import { notFound } from "next/navigation";

import { forTenant } from "@landingos/db";
import { can } from "@landingos/auth";

import { requireProduct } from "@/lib/console/product-page";
import { primaryPublicOrigin, publicPagePath } from "@/lib/console/public-page-url";
import { resolveStoreName } from "@/lib/storefront/store-identity";
import { BuilderApiProvider } from "@/lib/builder/api-base";
import { StorefrontApiProvider } from "@/lib/storefront/api-base";
import { toPreviewState } from "@/lib/landing/mappers";
import { EditWorkspace } from "@/components/landings/edit/edit-workspace";
import type { PublishStatus } from "@/components/landings/edit/edit-workspace-header";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The landing editor, on the platform.
 *
 * The editor itself is unchanged — 54 components and ~5,000 lines of genuinely
 * good UI, MOVED rather than rewritten. The only thing that differs from the
 * legacy mount is where it sends its requests, which BuilderApiProvider
 * supplies, and where its data comes from, which is now the tenant-bound
 * client instead of the pre-tenant one.
 *
 * Deliberately NOT wrapped in ConsoleShell. The editor is a full-bleed
 * workspace with its own header and a live preview beside it; a sidebar would
 * halve the canvas. Escaping the shell for a focused editing surface is a
 * normal thing for a console to do — but it means this screen has to do its
 * own entitlement check, which requireProduct handles.
 * ========================================================================== */

export default async function ConsoleEditLandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session } = await requireProduct("website-builder", `/console/builder/pages/${id}/edit`);

  // Reading is not enough to open an editor: every control in it writes.
  if (!can(session.auth!, "website-builder:pages:write")) notFound();

  const page = await forTenant(session.auth!.tenantId).landingPage.findUnique({
    where: { id },
    include: {
      media: { orderBy: { displayOrder: "asc" } },
      variants: { orderBy: { displayOrder: "asc" } },
      features: { orderBy: { displayOrder: "asc" } },
      reviews: { orderBy: { displayOrder: "asc" } },
      faqs: { orderBy: { displayOrder: "asc" } },
      setting: true,
      theme: true,
    },
  });

  // Another tenant's id simply does not resolve under the binding, so this is
  // a 404 rather than a leak that the row exists elsewhere.
  if (!page) notFound();

  // The store identity the preview drawer renders in the template's nav and
  // footer. Read here rather than in the drawer because the drawer is a client
  // component and this is the same query the published page already makes.
  const settings = await forTenant(session.auth!.tenantId).storeSettings.findUnique({
    where: { tenantId: session.auth!.tenantId },
    select: {
      storeName: true, storeDescription: true, logo: true,
      facebook: true, instagram: true, tiktok: true, whatsapp: true, telegram: true,
    },
  });

  /* LB.35b — the company's tracking integrations, so the Integrations section
   * can offer a per-page choice between them. INACTIVE ones are included: a
   * page linked to one stays linked, and listing only active rows would drop
   * that link the next time the section saved. No secret is selected —
   * `serverToken` and `testCode` never leave the server. */
  const integrations = await forTenant(session.auth!.tenantId).trackingIntegration.findMany({
    select: { id: true, provider: true, label: true, publicId: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  /* The column verbatim. `null` means "every active integration" and an array
   * means exactly itself, including an empty one — the section renders all
   * three states, so it must not be handed a normalised two. */
  const selectedTracking = Array.isArray(page.trackingIntegrationIds)
    ? (page.trackingIntegrationIds as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : null;

  // View / Copy Link speak the tenant's own domain once one is verified and
  // primary; the platform-prefixed path otherwise (LB.46).
  const publicOrigin = await primaryPublicOrigin(forTenant(session.auth!.tenantId));

  return (
    // Two providers, because the editor renders both worlds at once: its own
    // controls talk to the console API, and the live preview inside it renders
    // the customer-facing template. Pointing the preview at the tenant's own
    // storefront API is what makes it a preview rather than a rehearsal.
    <BuilderApiProvider base="/api/builder">
      <StorefrontApiProvider
        base={`/api/storefront/${session.tenant!.slug}`}
        pageBase={`/${session.tenant!.slug}`}
      >
      <EditWorkspace
        landingId={page.id}
        landingTitle={page.title}
        landingSlug={page.slug}
        publicPath={publicPagePath(publicOrigin, session.tenant!.slug, page.slug)}
        store={{
          name: resolveStoreName(settings?.storeName, session.tenant!.name),
          description: settings?.storeDescription ?? null,
          logo: settings?.logo ?? null,
          facebook: settings?.facebook ?? null,
          instagram: settings?.instagram ?? null,
          tiktok: settings?.tiktok ?? null,
          whatsapp: settings?.whatsapp ?? null,
          telegram: settings?.telegram ?? null,
          // Null on purpose: inside the drawer the brand is a label, not a
          // way out of the editor.
          homePath: null,
        }}
        initialPreview={toPreviewState(page)}
        initialSeo={{ seoTitle: page.seoTitle ?? "", seoDescription: page.seoDescription ?? "" }}
        trackingIntegrations={integrations}
        initialTracking={{ selected: selectedTracking }}
        initialStatus={(page.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT") as PublishStatus}
      />
      </StorefrontApiProvider>
    </BuilderApiProvider>
  );
}
