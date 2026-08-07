import { storeImage } from "@/lib/image-upload";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/* =============================================================================
 * A catalogue photograph — PM.2, restoring the last half of the legacy's image
 * support.
 *
 * WHAT WAS MISSING, AND FOR HOW LONG. `CatalogProduct.image` and the `image` on
 * every entry of the `variants` array have existed since M-06. Both are accepted
 * by `POST /api/erp/products` and `PUT /api/erp/products/[id]/variants`. Neither
 * has ever been rendered by anything, and there has never been a way to put a
 * file into either — the products screen offered a text box for a URL and its
 * own comment said "what still has no control is uploading a file".
 *
 * So the legacy, which uploads a product image, a per-variant image and a
 * whole-group image, and shows the resolved one inside every order row, had
 * three capabilities this platform had the columns for and no operator could
 * reach. That is this project's most-caught defect shape, in the one place four
 * audits did not look: the consumer side of a column, not the writer.
 *
 * `erp:products:write` is the gate, and it is the permission the routes that
 * STORE the resulting URL check. Uploading a file nobody may attach to anything
 * is a way to fill a bucket, not a feature.
 *
 * WHY THE ERP DOES NOT REUSE `/api/builder/upload`: that route is gated on
 * `website-builder:pages:write`, so a tenant subscribed to the ERP alone would
 * be refused — and widening its permission would make one product's gate serve
 * two. The processing is shared (`lib/image-upload.ts`); only the gate is not.
 *
 * M-14 NOTE. The legacy stores base64 data URLs inside SQLite, which is why its
 * JSON body limit is 25 MB and why every product query drags image bytes along.
 * This returns a KEY under `tenants/<id>/`, served by `/api/uploads/[...path]`
 * — so the column holds a short string and the bytes live in object storage,
 * which is what the schema comment has promised since Phase 3.2.
 * ========================================================================== */

export const POST = tenantRoute("erp:products:write", async ({ req, session }) => {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError(400, "NO_FILE", "Attach a file to the 'file' field.");
  }

  const result = await storeImage(formData.get("file"), session.auth!.tenantId);
  if (!result.ok) return apiError(400, result.refusal.code, result.refusal.message);

  return apiOk({ url: result.url, key: result.key });
});
