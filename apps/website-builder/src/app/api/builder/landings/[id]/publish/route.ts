import { z } from "zod";
import { apiOk, apiError } from "@/lib/api/route";
import { landingWriteRoute } from "@/lib/api/landing-write";
import { triggerProductWebhook } from "@/lib/webhooks/tenant-triggers";

export const dynamic = "force-dynamic";
type Params = { id: string };

const Body = z.object({ published: z.boolean().optional() });

/**
 * Publish or unpublish. Separate from the general section because it is the
 * one edit with a public consequence, and it carries its own permission —
 * someone may be trusted to draft a page without being trusted to put it live.
 */
export const POST = landingWriteRoute<Params>("website-builder:pages:publish", async ({ db, req, params, session, afterCommit }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const publish = parsed.success ? parsed.data.published ?? true : true;

  const page = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, price: true },
  });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  // Refuse to publish something a customer could not actually buy.
  if (publish && (!page.title?.trim() || page.price == null)) {
    return apiError(422, "NOT_PUBLISHABLE", "A page needs a title and a price before it can go live.");
  }

  await (db as any).landingPage.updateMany({
    where: { id: params.id },
    data: publish
      ? { status: "PUBLISHED", published: true }
      : { status: "DRAFT", published: false },
  });

  // The lifecycle event, after commit (LB.3). Going live is the one page
  // change an automation most wants to react to.
  const tenantId = session.auth!.tenantId;
  afterCommit(async () => {
    triggerProductWebhook(publish ? "page.published" : "page.unpublished", tenantId, params.id);
  });

  return apiOk({ id: params.id, status: publish ? "PUBLISHED" : "DRAFT", published: publish });
});
