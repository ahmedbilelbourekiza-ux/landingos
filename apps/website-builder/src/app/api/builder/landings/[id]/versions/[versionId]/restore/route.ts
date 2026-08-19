import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { restoreVersion } from "@/lib/landing/versions";
import { versionActor } from "@/lib/api/landing-write";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";
type Params = { id: string; versionId: string };

/* =============================================================================
 * LB.14b — put a page back to one of its saved versions.
 *
 * NOT wrapped in `landingWriteRoute`, and that is not an oversight: this is
 * the one write whose checkpoint must not be session-gated. `restoreVersion`
 * takes one unconditionally, tagged `restore`, before it overwrites anything —
 * so a restore chosen by mistake is itself undoable, including a second
 * restore in the same sitting, which the ordinary session rule would have
 * skipped.
 *
 * It lands as a DRAFT (decision 3, LB.34's precedent). That is a real
 * consequence and the console says so before the merchant presses it: a page
 * that was live comes off the storefront until it is published again. The
 * alternative — silently republishing an older version of a page a customer
 * may be mid-order on — is the worse surprise, and putting a page back on sale
 * has its own permission (`pages:publish`) which this route does not require.
 * ========================================================================== */
export const POST = tenantRoute<Params>(
  "website-builder:pages:write",
  async ({ db, params, session, afterCommit }) => {
    const version = await (db as any).landingPageVersion.findUnique({
      where: { id: params.versionId },
      select: { id: true, landingPageId: true, snapshot: true },
    });

    // Another tenant's version does not resolve under the binding. A version
    // of a DIFFERENT page of this tenant's does resolve, and would otherwise
    // let one page be overwritten with another's contents.
    if (!version || version.landingPageId !== params.id) {
      return apiError(404, "NOT_FOUND", "That version does not exist.");
    }

    const tenantId = session.auth!.tenantId;
    const result = await restoreVersion(
      db as any,
      params.id,
      version,
      versionActor(session),
      tenantId,
    );
    if (!result) return apiError(422, "UNREADABLE_VERSION", "That version cannot be read back.");

    afterCommit(async () => {
      triggerProductWebhook("product.updated", tenantId, params.id);
    });

    return apiOk({
      id: result.id,
      status: "DRAFT",
      published: false,
      // What the restore could NOT put back, so the console can say so rather
      // than let the merchant discover it: an address another page has taken
      // since, and references to things deleted since.
      slugRestored: result.slugRestored,
      droppedReferences: result.droppedReferences,
    });
  },
);
