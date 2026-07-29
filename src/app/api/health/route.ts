import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";
import { siteConfig } from "@/config/site";
import { getR2Config } from "@/lib/r2";

// Lightweight health check. Proves the API layer, the env/config wiring, and
// the database connection are all alive. Useful as a deployment probe and as
// the first thing to hit when debugging.
//
// `storage` reports which upload backend the running container resolved.
// Uploads silently fall back to local disk when the R2 variables are missing,
// and on a host with an ephemeral filesystem that failure is invisible until
// images vanish hours later — so the backend is surfaced here to make a
// misconfigured deploy obvious immediately. Only the resolved mode is
// reported, never credentials, bucket name, or account id.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;

    const r2 = getR2Config();
    return ok({
      status: "ok",
      service: siteConfig.name,
      version: siteConfig.version,
      storage: {
        backend: r2 ? "r2" : "local",
        // true → images are served straight from Cloudflare's CDN.
        // false with backend "r2" → proxied through this server (bucket stays
        // private). Both are valid; this just says which one is active.
        cdn: r2 ? r2.publicBaseUrl !== null : false,
      },
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] database unreachable:", error);
    return serverError("Database unreachable");
  }
}
