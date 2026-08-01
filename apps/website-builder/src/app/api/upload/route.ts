import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";

import { ok, fail, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";
import { getUploadsDir, contentTypeFor } from "@/lib/uploads";
import { isR2Configured, putObject } from "@/lib/r2";

// POST /api/upload — image upload for the landing builder.
//
// Accepts multipart/form-data with a single "file" field (image/jpeg,
// image/png, image/webp, or image/avif). The image is:
//   1. Validated (type + size ≤ 8 MB)
//   2. Re-encoded/optimized via sharp (strips EXIF, converts to webp for
//      photos, preserves format for transparency)
//   3. Stored (Cloudflare R2 when configured, otherwise local disk)
//   4. The public URL is returned: /uploads/<uuid>.<ext>
//
// The route is protected by the middleware (deny-by-default: /api/upload is
// not in the public allowlist). We re-check auth here as defence in depth.
//
// Storage: R2 is used whenever its environment variables are set (see
// src/lib/r2.ts) — required in production because Render's free tier wipes
// the container filesystem on every restart. Without R2 configured it falls
// back to a local directory so development works with no cloud account.
//
// The returned URL shape is identical either way — always /uploads/<file> —
// so the database stores the same value regardless of backend and images
// uploaded before/after enabling R2 both keep working.
//
// NOTE: files must never be written into public/. Next.js only serves
// public/ files that existed at BUILD time, so a runtime write there is saved
// but silently 404s. Serving happens via /api/uploads/[...path] instead, with
// a rewrite in next.config.ts preserving the /uploads/<file> URLs.

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

    // Process the image: strip EXIF metadata, limit max dimensions to 2000px
    // on the longest edge (enough for high-DPI product photos without
    // storing enormous files), and re-encode in the original format at
    // quality 82 (visually identical, ~30% smaller).
    //
    // Produced as a buffer rather than written straight to a file, so the
    // same processed bytes can go to either storage backend.
    const processed = await sharp(bytes)
      .rotate() // auto-orient based on EXIF
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .toFormat(format, { quality: 82 })
      .toBuffer();

    if (isR2Configured()) {
      await putObject(filename, processed, contentTypeFor(filename));
    } else {
      const uploadsDir = getUploadsDir();
      await fs.mkdir(uploadsDir, { recursive: true });
      await fs.writeFile(path.join(uploadsDir, filename), processed);
    }

    // Return the public URL. /uploads/<file> is rewritten to the
    // /api/uploads/<file> route handler, which streams it back from disk.
    const url = `/uploads/${filename}`;
    return ok({ url, filename, size: file.size });
  } catch (error) {
    console.error("[api/upload] error:", error);
    return serverError("Upload failed");
  }
}
