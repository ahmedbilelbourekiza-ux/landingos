import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { ok, fail, fromZodError, serverError } from "@/lib/api-response";

const mediaItemSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["IMAGE", "VIDEO"]),
  url: z.string(),
  altText: z.string().optional().nullable(),
  displayOrder: z.number(),
});

const replaceSchema = z.object({
  media: z.array(mediaItemSchema),
});

// PUT /api/landings/[id]/media — replace all media (delete + create)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = replaceSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    await db.$transaction([
      db.landingMedia.deleteMany({ where: { landingPageId: id } }),
      ...parsed.data.media.map((m) =>
        db.landingMedia.create({
          data: {
            landingPageId: id,
            type: m.type,
            url: m.url,
            altText: m.altText ?? null,
            displayOrder: m.displayOrder,
          },
        }),
      ),
    ]);

    return ok({ id });
  } catch (error) {
    console.error("[api/landings/[id]/media] PUT error:", error);
    return serverError("Failed to update media");
  }
}
