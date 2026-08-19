import { Prisma } from "@landingos/db";

/* =============================================================================
 * LB.14b — page version history: the snapshot, the session rule, the restore.
 *
 * BUILDER_AUDIT M-02 asked for a way back. The editor saves each section
 * separately through eleven routes, every one of them a destructive
 * overwrite, and until this existed the only recovery a merchant had was to
 * have duplicated the page first.
 *
 * THE THREE DECISIONS THIS ENCODES, all made by the product owner rather than
 * discovered here:
 *
 *   1. A version is taken BEFORE THE FIRST EDIT OF EACH SESSION. Not per
 *      section save — that is eleven entries for one afternoon, and the list
 *      becomes trivia. Not per publish — the mis-save M-02 describes happens
 *      on a page nobody republishes. Session-start is the closest an editor
 *      that saves per section can honestly get to "undo": it restores the page
 *      to how it looked when you sat down.
 *
 *   2. Restoring an old price does NOT touch orders already taken. Nothing
 *      here has to enforce that, and that is the point: `SalesOrder` snapshots
 *      `productPrice`, `shippingPrice`, `totalPrice` and the chosen `variants`
 *      at checkout and never reads them back off the page. A restored price is
 *      the price of the NEXT order.
 *
 *   3. A restore lands as a DRAFT. LB.34 settled the neighbouring question the
 *      same way — restoring from the archive returns a page to DRAFT, never
 *      straight to live — and a version restore that silently republished
 *      would be the worse version of the same surprise. See `restoreVersion`,
 *      which forces the status rather than reading it from the snapshot.
 *
 * WHY THE FIELD LISTS ARE DERIVED. `duplicate` is the one other place that
 * knows what a whole page is, and its hand-written copy list has gone stale
 * FOUR times — `deliveryPrices` (LB.20), `trackingIntegrationIds` (LB.35),
 * `brandId` (LB.36), `behaviorTracking` (BH.1), each one shipping a copy that
 * looked complete and was not. So nothing here names a column. Scalars come
 * from Prisma's own DMMF, which means a column added tomorrow is snapshotted
 * and restored by this file with no edit to it. Only the RELATION split is
 * written down, because "content" versus "history" is a judgement no schema
 * can make — and the suite asserts that every relation on `LandingPage`
 * appears in exactly one of the four lists below, so the next one cannot be
 * added without somebody deciding which it is.
 * ========================================================================== */

/** How long a sitting survives silence before the next edit starts a new one. */
export const SESSION_IDLE_MINUTES = 30;

/**
 * Versions kept per page, newest first; older ones are pruned as new ones are
 * taken. At one version per editing session this is months of history, and it
 * bounds a Json column that would otherwise grow for the life of the page.
 */
export const MAX_VERSIONS_PER_PAGE = 50;

/* ---- the relation split: what a page IS, versus what happened to it ------ */

/** Owned content, many rows, restored by delete-and-recreate. */
export const SNAPSHOT_TO_MANY = [
  "media",
  "variants",
  "features",
  "reviews",
  "faqs",
  "deliveryPrices",
] as const;

/** Owned content, one row. Same treatment, singular. */
export const SNAPSHOT_TO_ONE = ["setting"] as const;

export const SNAPSHOT_RELATIONS: readonly string[] = [...SNAPSHOT_TO_MANY, ...SNAPSHOT_TO_ONE];

/**
 * What HAPPENED to the page. Deliberately not snapshotted and never restored:
 * an order, a captured lead, a visit and an AI insight are records of the
 * past, and rewriting them to match an older shape of the page would be
 * falsifying them. `versions` itself is here for the obvious reason.
 */
export const HISTORY_RELATIONS = [
  "salesOrders",
  "draftOrders",
  "visits",
  "insights",
  "versions",
] as const;

/**
 * Things the page POINTS AT rather than owns. Their scalar foreign key
 * (`categoryId`, `themeId`, `brandId`) is an ordinary column and is captured
 * by the scalar sweep; the rows themselves belong to the tenant, not the page,
 * and a version must not resurrect a category the merchant has since deleted.
 * `restoreVersion` drops a reference that no longer resolves — the same answer
 * the schema itself gives these three columns (`onDelete: SetNull`).
 */
export const REFERENCE_RELATIONS = ["category", "theme", "brand"] as const;

/** Prisma client accessor for each snapshotted relation. */
export const RELATION_MODEL: Readonly<Record<string, string>> = {
  media: "landingMedia",
  variants: "landingVariant",
  features: "landingFeature",
  reviews: "landingReview",
  faqs: "landingFAQ",
  deliveryPrices: "landingDeliveryPrice",
  setting: "landingSetting",
};

/**
 * The read that produces a snapshot. Ordered where an order exists, so two
 * snapshots of an unchanged page are identical and a future diff view has
 * something stable to compare.
 */
export const PAGE_SNAPSHOT_INCLUDE = {
  media: { orderBy: { displayOrder: "asc" } },
  variants: { orderBy: { displayOrder: "asc" } },
  features: { orderBy: { displayOrder: "asc" } },
  reviews: { orderBy: { displayOrder: "asc" } },
  faqs: { orderBy: { displayOrder: "asc" } },
  deliveryPrices: { orderBy: { wilayaId: "asc" } },
  setting: true,
} as const;

/* ---- derived field lists (DMMF, so they cannot go stale) ----------------- */

/** Identity and bookkeeping: never copied out of a snapshot, on any model. */
const NEVER_RESTORED = new Set(["id", "tenantId", "landingPageId", "createdAt", "updatedAt"]);

/**
 * Decision 3, mechanically: the two columns a restore is not allowed to carry.
 * A page comes back as a draft and is republished deliberately.
 */
export const STATUS_COLUMNS: ReadonlySet<string> = new Set(["status", "published"]);

type ModelShape = { scalars: string[]; json: Set<string> };
const shapeCache = new Map<string, ModelShape>();

function shapeOf(modelName: string): ModelShape {
  const cached = shapeCache.get(modelName);
  if (cached) return cached;

  const model = (Prisma as any).dmmf.datamodel.models.find((m: any) => m.name === modelName);
  if (!model) throw new Error(`versions: no such model in the datamodel: ${modelName}`);

  const scalars: string[] = [];
  const json = new Set<string>();
  for (const field of model.fields) {
    if (field.kind !== "scalar" && field.kind !== "enum") continue;
    if (NEVER_RESTORED.has(field.name)) continue;
    scalars.push(field.name);
    if (field.type === "Json") json.add(field.name);
  }

  const shape = { scalars, json };
  shapeCache.set(modelName, shape);
  return shape;
}

/** The Prisma client accessor (`landingFAQ`) for a model name (`LandingFAQ`). */
function accessorToModelName(accessor: string): string {
  const model = (Prisma as any).dmmf.datamodel.models.find(
    (m: any) => m.name[0].toLowerCase() + m.name.slice(1) === accessor,
  );
  if (!model) throw new Error(`versions: no model behind the accessor ${accessor}`);
  return model.name;
}

/**
 * Copy a snapshotted row's own columns back out, ready to write.
 *
 * NULL IS NOT ONE VALUE HERE. On an ordinary column an explicit `null` is what
 * clears it, and omitting it would silently keep whatever the live row holds —
 * so a restore meant to remove an announcement would not remove it. On a
 * nullable JSON column Prisma reads a bare `null` as the JSON value `null`, a
 * third state beside "absent" and "a list" (the trap `duplicate` documents on
 * `trackingIntegrationIds`), so those need `Prisma.DbNull` to mean the column
 * is empty. Which columns are JSON comes from the datamodel, not from here.
 */
export function restorableColumns(
  modelName: string,
  row: Record<string, unknown>,
  skip: ReadonlySet<string> = new Set<string>(),
): Record<string, unknown> {
  const { scalars, json } = shapeOf(modelName);
  const out: Record<string, unknown> = {};
  for (const field of scalars) {
    if (skip.has(field)) continue;
    // A column added since this snapshot was taken has no value in it. Leaving
    // it out keeps the live value (or the schema default) rather than writing
    // an undefined the merchant never chose.
    if (!(field in row)) continue;
    const value = row[field];
    out[field] = value === null && json.has(field) ? Prisma.DbNull : value;
  }
  return out;
}

/* ---- the session rule (pure, so it is testable without a database) ------- */

export interface EditingSessionMark {
  readonly sessionId: string | null;
  readonly lastEditAt: Date;
}

/**
 * Does this write belong to the sitting `previous` already marked?
 *
 * Both halves matter. A different auth session is a different person or a
 * different device, and each is owed its own "before I started". The idle gap
 * is what stops a 14-day auth session — the TTL this platform actually uses —
 * from collapsing a fortnight of editing into a single version.
 *
 * A caller with no session id never continues one: it cannot be recognised
 * next time, so treating it as a continuation would attach its edits to
 * somebody else's mark.
 */
export function continuesEditingSession(
  previous: EditingSessionMark | null,
  sessionId: string | null,
  now: Date = new Date(),
): boolean {
  if (!previous || !sessionId) return false;
  if (previous.sessionId !== sessionId) return false;
  const idleMs = now.getTime() - previous.lastEditAt.getTime();
  return idleMs >= 0 && idleMs < SESSION_IDLE_MINUTES * 60_000;
}

/* ---- taking a version --------------------------------------------------- */

export interface VersionActor {
  readonly sessionId: string | null;
  readonly userId: string | null;
  readonly userName: string | null;
}

/** Read a page and everything it owns, or null if it is not this tenant's. */
export async function snapshotPage(db: any, landingPageId: string) {
  return db.landingPage.findUnique({
    where: { id: landingPageId },
    include: PAGE_SNAPSHOT_INCLUDE,
  });
}

/**
 * Write one version row, then prune this page's oldest beyond the cap.
 *
 * Runs inside the caller's transaction — `withTenant` has already opened one —
 * so an edit that throws takes its own checkpoint down with it and cannot
 * leave a version describing a page state that never existed.
 */
export async function takeVersion(
  db: any,
  landingPageId: string,
  actor: VersionActor,
  reason: "edit" | "restore",
  tenantId: string,
) {
  const page = await snapshotPage(db, landingPageId);
  if (!page) return null; // not this tenant's page, or gone: the caller will 404

  const version = await db.landingPageVersion.create({
    data: {
      tenantId,
      landingPageId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      sessionId: actor.sessionId,
      reason,
      snapshot: page,
    },
    select: { id: true, createdAt: true },
  });

  const surplus = await db.landingPageVersion.findMany({
    where: { landingPageId },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS_PER_PAGE,
    select: { id: true },
  });
  if (surplus.length) {
    await db.landingPageVersion.deleteMany({
      where: { id: { in: surplus.map((row: any) => row.id) } },
    });
  }

  return version;
}

/**
 * Decision 1, at the one moment it can be applied: just before a write.
 *
 * Lazy on purpose. Opening the editor is not editing, and a checkpoint taken
 * when the screen loads would fill the list with versions of pages nobody
 * touched. The first write of a sitting is the first moment a way back is
 * worth anything.
 *
 * When the sitting is already marked this only bumps its clock, which is what
 * keeps three hours of continuous work down to a single version.
 */
export async function ensureSessionCheckpoint(
  db: any,
  landingPageId: string,
  actor: VersionActor,
  tenantId: string,
  now: Date = new Date(),
) {
  // Probed by SESSION, not simply "newest": two people editing the same page
  // alternately each keep their own mark, instead of resetting each other's
  // and taking a checkpoint on every single write.
  const previous = actor.sessionId
    ? await db.landingPageVersion.findFirst({
        where: { landingPageId, sessionId: actor.sessionId },
        orderBy: { createdAt: "desc" },
        select: { id: true, sessionId: true, lastEditAt: true },
      })
    : null;

  if (continuesEditingSession(previous, actor.sessionId, now)) {
    await db.landingPageVersion.update({ where: { id: previous.id }, data: { lastEditAt: now } });
    return null;
  }

  return takeVersion(db, landingPageId, actor, "edit", tenantId);
}

/* ---- restoring ---------------------------------------------------------- */

export interface RestoreResult {
  readonly id: string;
  readonly slugRestored: boolean;
  readonly droppedReferences: string[];
}

/**
 * Put a page back to a stored version, as a DRAFT (decision 3).
 *
 * Owned rows are replaced rather than reconciled — delete every one, recreate
 * from the snapshot — which is the shape `variants`'s PUT already uses and
 * therefore a pattern known to be safe inside `withTenant`'s transaction.
 * Reconciling row by row would need stable identities these rows do not have.
 *
 * Two things a snapshot cannot simply be trusted about, because the world
 * moved on around it:
 *
 *   THE SLUG may have been taken by another page since. Restoring it would
 *   collide with a live URL, and refusing the whole restore over an address
 *   would be a dead end for the merchant, so the page keeps its current slug
 *   and the caller is told which happened.
 *
 *   A CATEGORY, THEME OR BRAND may have been deleted since. Those columns are
 *   `onDelete: SetNull` precisely because the platform's answer to that is
 *   "the page carries on without one"; re-pointing at a missing row would fail
 *   the constraint and lose the entire restore.
 *
 * `trackingIntegrationIds` needs neither guard: that column's stated contract
 * is already that ids which no longer resolve are ignored at read time.
 */
export async function restoreVersion(
  db: any,
  landingPageId: string,
  version: { id: string; snapshot: any },
  actor: VersionActor,
  tenantId: string,
): Promise<RestoreResult | null> {
  const snapshot = version.snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;

  // The state being overwritten is captured first and ALWAYS — the session
  // rule is skipped here deliberately. Restoring is destructive, and a restore
  // pressed by mistake has to be as recoverable as the edits it replaced.
  await takeVersion(db, landingPageId, actor, "restore", tenantId);

  const skip = new Set<string>([...STATUS_COLUMNS, "slug"]);
  const data = restorableColumns("LandingPage", snapshot, skip);

  // Dangling references: check, then drop what no longer exists.
  const droppedReferences: string[] = [];
  for (const [column, accessor] of [
    ["categoryId", "category"],
    ["themeId", "landingTheme"],
    ["brandId", "brand"],
  ] as const) {
    const id = (snapshot as any)[column];
    if (!id) continue;
    const found = await db[accessor].findUnique({ where: { id }, select: { id: true } });
    if (!found) {
      data[column] = null;
      droppedReferences.push(column);
    }
  }

  // The slug, if nothing else has claimed it meanwhile.
  let slugRestored = false;
  if (typeof snapshot.slug === "string" && snapshot.slug) {
    const clash = await db.landingPage.findFirst({
      where: { slug: snapshot.slug, NOT: { id: landingPageId } },
      select: { id: true },
    });
    if (!clash) {
      data.slug = snapshot.slug;
      slugRestored = true;
    }
  }

  await db.landingPage.updateMany({
    where: { id: landingPageId },
    // Decision 3: a restored page is a draft, whatever the snapshot said and
    // whatever it was a moment ago. Republishing is its own decision, with its
    // own permission and its own publishability checks.
    data: { ...data, status: "DRAFT", published: false },
  });

  for (const relation of SNAPSHOT_RELATIONS) {
    const accessor = RELATION_MODEL[relation];
    await db[accessor].deleteMany({ where: { landingPageId } });

    const stored = (snapshot as any)[relation];
    const rows = (Array.isArray(stored) ? stored : stored ? [stored] : []) as Record<string, unknown>[];
    if (!rows.length) continue;

    const modelName = accessorToModelName(accessor);
    await db[accessor].createMany({
      data: rows.map((row) => ({
        ...restorableColumns(modelName, row),
        tenantId,
        landingPageId,
      })),
    });
  }

  return { id: landingPageId, slugRestored, droppedReferences };
}
