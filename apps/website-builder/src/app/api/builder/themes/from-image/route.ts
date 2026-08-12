import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { themeFromImage } from "@/lib/landing/palette";
import { readTenantImage } from "@/lib/landing/image-bytes";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Build a storefront theme out of a product photograph — LB.22.
 *
 * A merchant uploads one hero image and then picks colours by hand from a grid
 * of built-in themes that know nothing about their product. This reads the
 * colours that are already IN the photograph and saves them as a theme of
 * their own, which the General section's picker then offers like any other.
 *
 * IT CREATES A ROW RATHER THAN RETURNING A PREVIEW. `LandingPage.themeId` is a
 * relation, so a theme that is not a row cannot be selected; returning colours
 * for the client to hold would mean inventing a second, unsaved kind of theme
 * and teaching the editor about it. `isBuiltIn` stays false — this is the
 * tenant's own theme, editable and deletable like the copies they already own.
 *
 * WHAT IT REFUSES, and why each is a refusal rather than a guess:
 *   - an image that is not ours, or another tenant's (readTenantImage checks
 *     the owner segment — the storage layer has no idea who is asking);
 *   - an image with no colour to take: a white cutout, a transparent PNG.
 *     Inventing a plausible theme from no evidence is the worst outcome
 *     because it looks like it worked.
 * ========================================================================== */

const Body = z.object({
  /** A `/uploads/...` URL this tenant owns — normally the page's hero. */
  imageUrl: z.string().trim().min(1).max(2000),
  /** What to call the theme. The screen sends the page's title. */
  name: z.string().trim().min(1).max(120),
});

export const POST = tenantRoute("website-builder:pages:write", async ({ db, req, session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const tenantId = session.auth!.tenantId;
  const bytes = await readTenantImage(parsed.data.imageUrl, tenantId);
  if (!bytes) {
    return apiError(404, "NOT_FOUND", "That image could not be read.");
  }

  const palette = await themeFromImage(bytes);
  if (!palette) {
    // Its own code: this one names a fix the merchant can act on — use a
    // photograph with some colour in it — rather than "that did not work".
    return apiError(422, "NO_COLOURS", "That image has no colour to build a theme from.");
  }

  const created = await db.landingTheme.create({
    data: {
      tenantId,
      name: parsed.data.name,
      ...palette,
      isBuiltIn: false,
      // Last in the picker: a generated theme should sit after the curated
      // ones rather than displacing them.
      sortOrder: 100,
    },
  });

  return apiOk(created, { status: 201 });
});
