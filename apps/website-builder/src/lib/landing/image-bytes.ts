import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { getUploadsDir, isSafeUploadFilename } from "@/lib/uploads";
import { isR2Configured, getObject } from "@/lib/r2";

/* =============================================================================
 * Read back an image this platform stored — LB.22.
 *
 * The palette extractor needs the BYTES of a hero image that the merchant
 * uploaded earlier, and the only handle anything holds is the public URL the
 * upload route returned (`/uploads/tenants/<tenantId>/<file>`).
 *
 * THE TENANT ID IN THE PATH IS NOT TRUSTED, it is CHECKED. A caller could ask
 * for `/uploads/tenants/<someone-else>/<file>` and, without this, get another
 * company's product photograph back — the storage layer has no idea who is
 * asking. So the key is parsed and its tenant segment must equal the caller's
 * own; anything else is refused before a byte is read. This is the same reason
 * `/api/uploads/[...path]` guards each segment (G-03).
 * ========================================================================== */

/**
 * Bytes for a `/uploads/...` URL owned by `tenantId`, or null.
 *
 * Null covers every failure the caller treats identically — not ours, not
 * found, not readable — because a merchant does not need to know which.
 */
export async function readTenantImage(
  url: string,
  tenantId: string,
): Promise<Buffer | null> {
  // Only our own upload URLs. An absolute URL would make this a fetcher and
  // turn the palette route into an SSRF primitive pointed at anything.
  const prefix = "/uploads/";
  if (!url.startsWith(prefix)) return null;

  const key = url.slice(prefix.length);
  const segments = key.split("/");
  // Exactly `tenants/<tenantId>/<filename>` — the shape `storeImage` writes.
  if (segments.length !== 3) return null;
  const [scope, owner, filename] = segments;
  if (scope !== "tenants") return null;
  // The check this file exists for.
  if (owner !== tenantId) return null;
  if (!isSafeUploadFilename(filename)) return null;

  if (isR2Configured()) {
    const object = await getObject(key);
    if (object) return object.body;
    // Fall through: images uploaded before R2 was switched on are on disk.
  }

  try {
    return await fs.readFile(path.join(getUploadsDir(), "tenants", owner, filename));
  } catch {
    return null;
  }
}
