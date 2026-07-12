import { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail, serverError } from "@/lib/api-response";

// Accepted image MIME types and their file extensions.
const ACCEPTED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// POST /api/upload — receives a single image file, validates type + size,
// saves it to public/uploads/, and returns the served URL. Files are named
// with a cuid-like prefix to avoid collisions. No image processing or
// optimization — the file is stored as-is.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return fail("NO_FILE", "No file provided", 400);
    }

    // Validate type
    const ext = ACCEPTED_TYPES[file.type];
    if (!ext) {
      return fail(
        "INVALID_TYPE",
        "Only JPG, PNG, WEBP, and AVIF images are allowed",
        422,
      );
    }

    // Validate size
    if (file.size > MAX_SIZE) {
      return fail("FILE_TOO_LARGE", "Maximum file size is 5 MB", 422);
    }

    // Generate a unique filename. Using crypto.randomUUID + extension.
    const filename = `${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Write to public/uploads/. In production this would be S3 or similar;
    // for the MVP, local filesystem is sufficient.
    const { writeFile, mkdir } = await import("fs/promises");
    const path = await import("path");
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), buffer);

    const url = `/uploads/${filename}`;
    return ok({ url }, 201);
  } catch (error) {
    console.error("[api/upload] error:", error);
    return serverError("Failed to upload file");
  }
}
