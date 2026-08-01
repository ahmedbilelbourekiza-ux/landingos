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
  // Which list is being replaced. Defaults to GALLERY so the existing gallery
  // editor, which does not send this field, keeps working unchanged.
  placement: z.enum(["GALLERY", "DESCRIPTION"]).default("GALLERY"),
});

// PUT /api/landings/[id]/media — replace one placement's media list.
//
// Replace-all (delete + recreate) rather than a diff: the client owns the
// ordering and sends the finished list, so recreating is both simpler and
// immune to the drift a partial update can leave behind.
//
// The delete is SCOPED TO THE PLACEMENT, which is load-bearing. Gallery and
// description images share this table, so an unscoped deleteMany would erase
// every description image each time the gallery was saved, and vice versa.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = replaceSchema.safeParse(body);
    if (!parsed.success) return fromZodError(parsed.error);

    const { media, placement } = parsed.data;

    const page = await db.landingPage.findUnique({ where: { id }, select: { id: true } });
    if (!page) return fail("NOT_FOUND", "Landing page not found", 404);

    await db.$transaction([
      db.landingMedia.deleteMany({ where: { landingPageId: id, placement } }),
      ...media.map((m) =>
        db.landingMedia.create({
          data: {
            landingPageId: id,
            type: m.type,
            url: m.url,
            altText: m.altText ?? null,
            displayOrder: m.displayOrder,
            placement,
          },
        }),
      ),
    ]);

    return ok({ id, placement, count: media.length });
  } catch (error) {
    console.error("[api/landings/[id]/media] PUT error:", error);
    return serverError("Failed to update media");
  }
}
