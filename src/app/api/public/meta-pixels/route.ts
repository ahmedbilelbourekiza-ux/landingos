import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-response";

// GET /api/public/meta-pixels — public, unauthenticated. Returns the
// browser-side Meta Pixel ID for the storefront pixel script.
//
// IMPORTANT: this reads StoreSettings.metaBrowserPixelId — the standalone
// browser pixel setting. It deliberately does NOT look at MetaPixelConfig
// (the server-side CAPI credentials). The two systems are independent:
// disabling or deleting every CAPI config must not stop the browser pixel
// from firing PageView/ViewContent/InitiateCheckout, and vice versa.
//
// Access tokens are never touched by this route — they are CAPI-only,
// server-side secrets.
export async function GET() {
  try {
    const settings = await db.storeSettings.findUnique({
      where: { id: "singleton" },
      select: { metaBrowserPixelId: true },
    });

    const pixelId = settings?.metaBrowserPixelId?.trim() || null;
    return ok({ pixelId });
  } catch (error) {
    console.error("[api/public/meta-pixels] GET error:", error);
    return serverError("Failed to fetch browser pixel");
  }
}
