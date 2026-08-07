import { storeImage } from "@/lib/image-upload";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Image upload, on the platform.
 *
 * The processing moved to `lib/image-upload.ts` in PM.2 when the ERP needed the
 * identical thing for product photographs. What stayed here is the only part
 * that is this product's: the permission. A shared uploader carrying its own
 * gate would be one permission for two products, which is the shape the product
 * registry exists to prevent.
 *
 * Auth and tenant come from `tenantRoute`, so an unauthenticated upload is
 * impossible rather than merely checked.
 * ========================================================================== */

export const POST = tenantRoute("website-builder:pages:write", async ({ req, session }) => {
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
