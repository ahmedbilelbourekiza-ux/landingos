import { NextRequest } from "next/server";
import path from "path";
import { promises as fs } from "fs";

import { getUploadsDir, isSafeUploadFilename, contentTypeFor } from "@/lib/uploads";

// GET /api/uploads/<filename> — serves a runtime-uploaded image.
//
// Next.js only serves public/ files that existed at BUILD time, so uploaded
// images cannot be served as static assets. next.config.ts rewrites
// /uploads/:path* here (as an afterFiles rewrite, so genuine build-time files
// in public/uploads still win and are served statically as before).
//
// This route is PUBLIC: storefront product images must be visible to
// customers who are not logged in. It only ever reads from the uploads
// directory and only ever returns image bytes.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: segments } = await params;

    // Uploads are stored flat — one directory, "<uuid>.<ext>" filenames. A
    // nested path can only be a traversal attempt or a bad record, so reject
    // anything that is not a single safe segment rather than trying to
    // normalize it.
    if (!segments || segments.length !== 1) {
      return new Response("Not found", { status: 404 });
    }

    const filename = segments[0];
    if (!isSafeUploadFilename(filename)) {
      return new Response("Not found", { status: 404 });
    }

    const uploadsDir = getUploadsDir();
    const filePath = path.join(uploadsDir, filename);

    // Defence in depth: even after the filename check, confirm the resolved
    // path really is inside the uploads directory before reading it.
    const resolvedDir = path.resolve(uploadsDir);
    const resolvedFile = path.resolve(filePath);
    if (resolvedFile !== path.join(resolvedDir, filename)) {
      return new Response("Not found", { status: 404 });
    }

    let file: Buffer;
    try {
      file = await fs.readFile(resolvedFile);
    } catch {
      return new Response("Not found", { status: 404 });
    }

    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(filename),
        "Content-Length": String(file.byteLength),
        // Filenames are UUIDs and content never changes for a given name,
        // so this is safe to cache aggressively.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[api/uploads] error:", error);
    return new Response("Not found", { status: 404 });
  }
}
