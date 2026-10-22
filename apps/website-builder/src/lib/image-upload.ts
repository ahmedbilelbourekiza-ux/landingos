import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getUploadsDir, contentTypeFor } from "@/lib/uploads";
import { isR2Configured, putObject } from "@/lib/r2";

/* =============================================================================
 * One image-upload implementation, for every product that needs one — PM.2.
 *
 * WHY IT IS SHARED RATHER THAN COPIED. `POST /api/builder/upload` has done this
 * since the builder was ported, and the ERP needs the identical thing for
 * product and variant photographs — same EXIF stripping, same 2000px cap, same
 * tenant-prefixed key. A second copy would be a second place the size limit,
 * the format list and the storage prefix live, and the day one of them changes
 * is the day a tenant's ERP images stop landing where a tenant deletion looks
 * for them.
 *
 * WHAT IT IS NOT. It is not a permission check and it is not a route. Each
 * caller wraps it in its own `tenantRoute` with the permission ITS product
 * declares — `website-builder:pages:write` for a landing page, and
 * `erp:products:write` for a catalogue photograph — because a shared uploader
 * that carried its own gate would be one permission for two products, which is
 * the shape the product registry exists to prevent.
 *
 * THE PROCESSING: EXIF stripped (auto-orienting first, so a portrait photo
 * does not arrive on its side), WIDTH capped at 2000px and HEIGHT at 12000px,
 * re-encoded at quality 82 in the ORIGINAL format so a PNG with an alpha
 * channel keeps it.
 *
 * IQ.1 — WHY THE HEIGHT CAP IS NOT ALSO 2000. It used to be (2000×2000,
 * "longest edge"), and that silently ruined tall description posters: a
 * 1080×8000 poster was stored 270×2000, then stretched across a phone that
 * needs ~1100px — measured on the live honey page, whose description image
 * sits in storage at 267×2000. Width is what the screen consumes, so width
 * is what we cap. 12000 keeps a 1:10 poster at a full 1200px wide, and it
 * stays under WebP's 16383px limit: the optimizer never enlarges, so no
 * `/_next/image` output can be taller than the stored file. Ordinary photos
 * (landscape, square, mild portrait) come out exactly as before.
 * ========================================================================== */

/** Kept equal to the top of `images.deviceSizes` in next.config.ts. */
export const MAX_IMAGE_WIDTH = 2000;
/** Tall posters only; under WebP's 16383px ceiling (see above). */
export const MAX_IMAGE_HEIGHT = 12000;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const FORMAT_MAP: Record<string, "jpeg" | "png" | "webp" | "avif"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export type UploadRefusal =
  | { readonly code: "NO_FILE"; readonly message: string }
  | { readonly code: "INVALID_FILE_TYPE"; readonly message: string }
  | { readonly code: "FILE_TOO_LARGE"; readonly message: string };

export type UploadResult =
  | { readonly ok: true; readonly url: string; readonly key: string }
  | { readonly ok: false; readonly refusal: UploadRefusal };

/**
 * Store one image against a tenant.
 *
 * Objects live under `tenants/<tenantId>/` so one tenant's uploads are a
 * distinct prefix in the bucket rather than loose files sharing a namespace —
 * which matters for quota accounting, for deleting a tenant, and for the day a
 * signed-URL policy needs a boundary to apply to.
 */
export async function storeImage(file: unknown, tenantId: string): Promise<UploadResult> {
  if (!file || !(file instanceof File)) {
    return { ok: false, refusal: { code: "NO_FILE", message: "Attach a file to the 'file' field." } };
  }

  const format = FORMAT_MAP[file.type];
  if (!format) {
    return {
      ok: false,
      refusal: {
        code: "INVALID_FILE_TYPE",
        message: `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, WebP, AVIF.`,
      },
    };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      refusal: {
        code: "FILE_TOO_LARGE",
        message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum allowed: 8 MB.`,
      },
    };
  }

  const ext = format === "jpeg" ? "jpg" : format;
  const filename = `${randomUUID()}.${ext}`;
  const key = `tenants/${tenantId}/${filename}`;

  const processed = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate() // auto-orient from EXIF before stripping it
    .resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, { fit: "inside", withoutEnlargement: true })
    .toFormat(format, { quality: 82 })
    .toBuffer();

  if (isR2Configured()) {
    await putObject(key, processed, contentTypeFor(filename));
  } else {
    // Local disk is the self-hosting fallback. On an ephemeral container these
    // files do not survive a restart, which is exactly why R2 exists.
    const dir = path.join(getUploadsDir(), "tenants", tenantId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), processed);
  }

  return { ok: true, url: `/uploads/${key}`, key };
}
