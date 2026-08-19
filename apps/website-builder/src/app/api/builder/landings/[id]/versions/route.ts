import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { MAX_VERSIONS_PER_PAGE } from "@/lib/landing/versions";

export const dynamic = "force-dynamic";
type Params = { id: string };

/**
 * LB.14b — this page's saved versions, newest first.
 *
 * The snapshot column is deliberately NOT selected. A list is a list of dates
 * and names; sending fifty page snapshots to draw fifty rows would be tens of
 * thousands of times the payload for information nobody is looking at yet. The
 * restore route reads the one that gets chosen.
 *
 * `read` rather than `write`: seeing what a page used to be is reading it. The
 * restore route below carries the write permission.
 */
export const GET = tenantRoute<Params>("website-builder:read", async ({ db, params }) => {
  const page = await (db as any).landingPage.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!page) return apiError(404, "NOT_FOUND", "That page does not exist.");

  const versions = await (db as any).landingPageVersion.findMany({
    where: { landingPageId: params.id },
    orderBy: { createdAt: "desc" },
    take: MAX_VERSIONS_PER_PAGE,
    select: {
      id: true,
      reason: true,
      actorUserId: true,
      actorName: true,
      createdAt: true,
      lastEditAt: true,
    },
  });

  return apiOk({ versions, max: MAX_VERSIONS_PER_PAGE });
});
