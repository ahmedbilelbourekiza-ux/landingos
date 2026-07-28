import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";

import { ok, fail, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";
import { getUploadsDir } from "@/lib/uploads";

// POST /api/upload — image upload for the landing builder.
//
// Accepts multipart/form-data with a single "file" field (image/jpeg,
// image/png, image/webp, or image/avif). The image is:
//   1. Validated (type + size ≤ 8 MB)
//   2. Re-encoded/optimized via sharp (strips EXIF, converts to webp for
//      photos, preserves format for transparency)
//   3. Saved to the runtime uploads directory (see src/lib/uploads.ts)
//   4. The public URL is returned: /uploads/<uuid>.<ext>
//
// The route is protected by the middleware (deny-by-default: /api/upload is
// not in the public allowlist). We re-check auth here as defence in depth.
//
// Storage location: NOT public/uploads. Next.js only serves files that were
// in public/ at BUILD time, so anything written there at runtime is saved but
// never served — the image silently 404s. Files therefore go to the uploads
// directory resolved by getUploadsDir() and are served back by the
// /api/uploads/[...path] route, with a rewrite in next.config.ts keeping the
// public-facing /uploads/<file> URLs unchanged.
//
// This is single-instance local-disk storage. For multi-instance or
// CDN-backed deployments, swap the sharp .toFile() call for your storage
// provider's upload and return its URL instead.

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

// MIME → sharp format name. Sharp uses these to re-encode the image.
const FORMAT_MAP: Record<string, keyof sharp.FormatEnum> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export async function POST(req: NextRequest) {
  try {
    // Auth check (defence in depth — middleware already enforces this).
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return fail("NO_FILE", "No file provided. Attach a file to the 'file' field.", 400);
    }
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return fail("NO_FILE", "No file provided. Attach a file to the 'file' field.", 400);
    }

    // Validate MIME type.
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return fail(
        "INVALID_FILE_TYPE",
        `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, WebP, AVIF.`,
        400,
      );
    }

    // Validate file size.
    if (file.size > MAX_FILE_SIZE) {
      return fail(
        "FILE_TOO_LARGE",
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum allowed: 8 MB.`,
        400,
      );
    }

    // Read the file bytes and process with sharp.
    const bytes = Buffer.from(await file.arrayBuffer());
    const format = FORMAT_MAP[file.type]!;

    // Generate a unique filename. We use the original format (preserving
    // transparency for PNGs) rather than forcing webp, so logos with alpha
    // channels keep working.
    const ext = format === "jpeg" ? "jpg" : format;
    const filename = `${randomUUID()}.${ext}`;
    const uploadsDir = getUploadsDir();
    const filePath = path.join(uploadsDir, filename);

    // Ensure the uploads directory exists (idempotent).
    await fs.mkdir(uploadsDir, { recursive: true });

    // Process the image: strip EXIF metadata, limit max dimensions to 2000px
    // on the longest edge (enough for high-DPI product photos without
    // storing enormous files), and re-encode in the original format at
    // quality 82 (visually identical, ~30% smaller).
    await sharp(bytes)
      .rotate() // auto-orient based on EXIF
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .toFormat(format, { quality: 82 })
      .toFile(filePath);

    // Return the public URL. /uploads/<file> is rewritten to the
    // /api/uploads/<file> route handler, which streams it back from disk.
    const url = `/uploads/${filename}`;
    return ok({ url, filename, size: file.size });
  } catch (error) {
    console.error("[api/upload] error:", error);
    return serverError("Upload failed");
  }
}
