import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getUploadsDir, contentTypeFor } from "@/lib/uploads";
import { isR2Configured, putObject } from "@/lib/r2";
import { tenantRoute, apiOk, apiError } from "@/lib/api/route";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Image upload, on the platform.
 *
 * The processing is unchanged from the legacy route: EXIF stripped, longest
 * edge capped at 2000px, re-encoded at quality 82 in the ORIGINAL format so a
 * logo with an alpha channel keeps it.
 *
 * What changed is the key. Objects are stored under `tenants/<tenantId>/` so
 * one tenant's uploads are a distinct prefix in the bucket rather than loose
 * files sharing a namespace — which matters for quota accounting, for deleting
 * a tenant, and for the day a signed-URL policy needs a boundary to apply to.
 *
 * Auth and tenant come from tenantRoute, so an unauthenticated upload is
 * impossible rather than merely checked.
 * ========================================================================== */

const MAX_FILE_SIZE = 8 * 1024 * 1024;

const FORMAT_MAP: Record<string, "jpeg" | "png" | "webp" | "avif"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export const POST = tenantRoute("website-builder:pages:write", async ({ req, session }) => {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError(400, "NO_FILE", "Attach a file to the 'file' field.");
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return apiError(400, "NO_FILE", "Attach a file to the 'file' field.");
  }

  const format = FORMAT_MAP[file.type];
  if (!format) {
    return apiError(
      400,
      "INVALID_FILE_TYPE",
      `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, WebP, AVIF.`,
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return apiError(
      400,
      "FILE_TOO_LARGE",
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum allowed: 8 MB.`,
    );
  }

  const ext = format === "jpeg" ? "jpg" : format;
  const tenantId = session.auth!.tenantId;
  const filename = `${randomUUID()}.${ext}`;
  const key = `tenants/${tenantId}/${filename}`;

  const processed = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate() // auto-orient from EXIF before stripping it
    .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
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

  return apiOk({ url: `/uploads/${key}`, key });
});
