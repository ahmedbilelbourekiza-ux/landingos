import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/api-response";

// GET /api/landings/[id] — single landing with all relations
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const page = await db.landingPage.findUnique({
      where: { id },
      include: {
        media: { orderBy: { displayOrder: "asc" } },
        variants: { orderBy: { displayOrder: "asc" } },
        reviews: { orderBy: { displayOrder: "asc" } },
        setting: true,
      },
    });

    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);
    return ok(page);
  } catch (error) {
    console.error("[api/landings/[id]] GET error:", error);
    return serverError("Failed to fetch landing page");
  }
}

// DELETE /api/landings/[id] — delete landing (cascade deletes children)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    await db.landingPage.delete({ where: { id } });
    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]] DELETE error:", error);
    return serverError("Failed to delete landing page");
  }
}
