import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/api-response";

// POST /api/landings/[id]/publish — set status to PUBLISHED + published flag
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    await db.landingPage.update({
      where: { id },
      data: { status: "PUBLISHED", published: true },
    });

    return ok({ id, status: "PUBLISHED" });
  } catch (error) {
    console.error("[api/landings/[id]/publish] POST error:", error);
    return serverError("Failed to publish landing page");
  }
}
