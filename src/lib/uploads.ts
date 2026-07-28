import path from "path";

// Local-disk fallback location for uploaded images.
//
// This is only used when Cloudflare R2 is NOT configured (see src/lib/r2.ts).
// R2 is the production path — it survives Render's ephemeral filesystem —
// while this keeps local development and self-hosted deployments working with
// no cloud account required.
//
// IMPORTANT: this is deliberately NOT public/uploads. Next.js only serves
// files that were present in public/ at BUILD time — anything written there
// at runtime lands on disk but is never served, which silently produces
// broken images. Uploads are therefore stored outside public/ and served by
// the /api/uploads/[...path] route handler instead.
//
// The default sits under the same /app/data directory the SQLite database
// uses, so a single persistent disk mounted at /app/data preserves both the
// database and the uploaded images.
//
// Override with UPLOADS_DIR if you mount storage somewhere else.
export function getUploadsDir(): string {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");
}

// Filenames we generate are always "<uuid>.<ext>". Anything else is either a
// legacy record or an attempt at path traversal, so the serving route
// validates against this before touching the filesystem.
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

export function isSafeUploadFilename(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("..")) return false;
  return SAFE_FILENAME.test(name);
}

// Minimal extension → content-type map covering the formats /api/upload can
// produce, plus the formats already committed in public/uploads.
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}
