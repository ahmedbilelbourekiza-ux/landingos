import { notFound } from "next/navigation";

import { forTenant } from "@landingos/db";
import { can } from "@landingos/auth";

import { requireProduct } from "@/lib/console/product-page";
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
      reviews: { orderBy: { displayOrder: "asc" } },
      setting: true,
      theme: true,
    },
  });

  // Another tenant's id simply does not resolve under the binding, so this is
  // a 404 rather than a leak that the row exists elsewhere.
  if (!page) notFound();

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
        publicPath={`/${session.tenant!.slug}/${page.slug}`}
        initialPreview={toPreviewState(page)}
        initialSeo={{ seoTitle: page.seoTitle ?? "", seoDescription: page.seoDescription ?? "" }}
        initialStatus={(page.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT") as PublishStatus}
      />
      </StorefrontApiProvider>
    </BuilderApiProvider>
  );
}
