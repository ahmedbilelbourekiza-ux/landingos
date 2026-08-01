import { NextRequest } from "next/server";
import path from "path";
import { promises as fs } from "fs";

import { getUploadsDir, isSafeUploadFilename, contentTypeFor } from "@/lib/uploads";
import { isR2Configured, getObject, getPublicUrl } from "@/lib/r2";

// GET /api/uploads/<filename> — serves a runtime-uploaded image.
//
// Next.js only serves public/ files that existed at BUILD time, so uploaded
// images cannot be served as static assets. next.config.ts rewrites
// /uploads/:path* here (as an afterFiles rewrite, so genuine build-time files
// in public/uploads still win and are served statically as before).
//
// Lookup order:
//   1. R2_PUBLIC_BASE_URL set → 302 to Cloudflare's CDN, so image bytes never
//      pass through this server at all.
//   2. R2 configured → stream the object back through this route (keeps the
//      bucket private; no public bucket setup needed).
//   3. Otherwise → read from the local uploads directory.
//
// Step 3 also runs as a fallback when step 2 finds nothing in R2, so images
// uploaded to disk BEFORE R2 was switched on keep resolving.
//
// That fallback does NOT apply to step 1. Redirecting is unconditional and
// deliberately so — checking the object exists first would mean a round-trip
// to R2 on every image request, which is exactly the cost the CDN redirect
// exists to avoid. The consequence: on a host WITH a persistent disk, setting
// R2_PUBLIC_BASE_URL orphans any image still only on disk. Upload those to the
// bucket before setting it. On an ephemeral host there is nothing to orphan.
//
// This route is PUBLIC: storefront product images must be visible to
// customers who are not logged in. It only ever returns image bytes.

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

    // 1. Public bucket / custom domain — hand the browser straight to
    //    Cloudflare so this server never carries the image bytes.
    const publicUrl = getPublicUrl(filename);
    if (publicUrl) {
      return Response.redirect(publicUrl, 302);
    }

    // 2. Private R2 bucket — proxy the object through this route.
    if (isR2Configured()) {
      const object = await getObject(filename);
      if (object) {
        return new Response(new Uint8Array(object.body), {
          status: 200,
          headers: {
            "Content-Type": object.contentType ?? contentTypeFor(filename),
            "Content-Length": String(object.body.byteLength),
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      // Not in R2 — fall through to disk, which covers images uploaded
      // before R2 was enabled.
    }

    // 3. Local disk.
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
