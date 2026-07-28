import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";
import { getAuthenticatedAdmin } from "@/lib/auth/require-auth";
import { encryptToken, decryptToken, maskToken } from "@/lib/meta/crypto";

// GET /api/settings/meta-pixels — list all configs. Access tokens are never
// returned in full — only a masked last-4 preview, so an admin can tell
// configs apart without the real secret ever reaching the browser again.
//
// Auth is enforced by the middleware (this route is protected-by-default);
// we re-check here as defence in depth, matching every other settings route.
export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);

    const configs = await db.metaPixelConfig.findMany({
      orderBy: { createdAt: "desc" },
    });

    const data = configs.map((c) => ({
      id: c.id,
      label: c.label,
      pixelId: c.pixelId,
      accessTokenPreview: maskToken(decryptSafely(c.accessToken)),
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));

    return ok(data);
  } catch (error) {
    console.error("[api/settings/meta-pixels] GET error:", error);
    return serverError("Failed to fetch pixel configs");
  }
}

// Decrypting only to build the masked preview — never sent further than
// maskToken()'s last-4-chars output. If decryption ever fails (e.g.
// AUTH_SECRET rotated), fall back to a generic mask rather than erroring
// the whole list out.
function decryptSafely(encrypted: string): string {
  try {
    return decryptToken(encrypted);
  } catch {
    return "????";
  }
}

const createSchema = z.object({
  label: z.string().min(1, "Label is required"),
  pixelId: z.string().min(1, "Pixel ID is required"),
  accessToken: z.string().min(1, "Access token is required"),
  isActive: z.boolean().optional(),
});

// POST /api/settings/meta-pixels — create a new pixel config.
export async function POST(req: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) return fail("UNAUTHORIZED", "Not authenticated", 401);
    if (admin.mustChangePassword) {
      return fail(
        "MUST_CHANGE_PASSWORD",
        "يجب تغيير كلمة المرور الافتراضية قبل تعديل الإعدادات",
        403,
      );
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const { label, pixelId, accessToken, isActive } = parsed.data;

    const created = await db.metaPixelConfig.create({
      data: {
        label,
        pixelId,
        accessToken: encryptToken(accessToken),
        isActive: isActive ?? false,
      },
      select: { id: true },
    });

    return ok(created, 201);
  } catch (error) {
    console.error("[api/settings/meta-pixels] POST error:", error);
    return serverError("Failed to create pixel config");
  }
}
