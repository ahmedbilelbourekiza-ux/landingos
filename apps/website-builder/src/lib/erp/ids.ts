import "server-only";

import type { TenantDb } from "@landingos/db";

/* =============================================================================
 * Human-readable, per-tenant record REFERENCES (D-05.2, D-05.3).
 *
 * This is a call-centre tool. Agents read order numbers to customers over the
 * phone. `ORD-0042` survives that; a cuid does not.
 *
 * Two things changed on the way across, and both were found rather than
 * anticipated:
 *
 * D-05.2 — GENERATION. The ERP counted the rows and probed upward for a free
 * slot. Two concurrent creates read the same count and race for the same value.
 * Now it is one atomic increment on a per-tenant counter row; see
 * TenantSequence in platform.prisma.
 *
 * D-05.3 — WHERE IT GOES. The ERP used the number as the primary key, which is
 * impossible here: `id` is a global unique index, so the second tenant's
 * ORD-0001 collides with the first tenant's. It is a `reference` column now,
 * unique per tenant, and the key is an ordinary cuid. See FulfillmentOrder in
 * erp.prisma for the alternatives that were rejected.
 * ========================================================================== */

/**
 * The counters the ERP keeps, and the prefix each one numbers.
 *
 * Only records a human quotes get one. A Client is identified by phone number
 * and a Shipment by its carrier tracking number — those are the references
 * people actually use, and minting a second one would invite two ways to name
 * the same thing.
 */
const PREFIX = {
  order: "ORD",
  product: "PRD",
} as const;

export type SequenceName = keyof typeof PREFIX;

/** Minimum digits, so ORD-0001 sorts next to ORD-0002 in a spreadsheet. */
const WIDTH: Record<SequenceName, number> = {
  order: 4,
  product: 3,
};

/**
 * The next reference for `name`, in this tenant.
 *
 * `upsert` compiles to INSERT … ON CONFLICT DO UPDATE, so the read and the
 * increment are one statement and one row lock. A concurrent caller blocks on
 * that lock and then reads the incremented value — it does not observe the old
 * one, which is exactly the failure the ERP's version had.
 *
 * MUST be called on a client from `withTenant`. The row is tenant-scoped and
 * carries an RLS policy like every other scoped table, so an unbound client
 * would find no row, insert one, and start every tenant back at 1.
 *
 * Width is a MINIMUM, not a limit: the 10,000th order is ORD-10000, not a
 * collision. Padding exists so ids sort and read consistently, and a scheme
 * that breaks at a round number is a scheme that breaks in production.
 */
export async function nextReference(
  db: TenantDb,
  tenantId: string,
  name: SequenceName,
): Promise<string> {
  /* THE COUNTER MUST NOT START AT 1 IN A TENANT THAT ALREADY HAS REFERENCES.
   *
   * Found by creating an order through the console in the seeded demo tenant:
   * `POST /api/erp/orders` answered **500** with `P2002` on
   * `(tenantId, reference)`. The seed writes `ORD-0001`…`ORD-0006` directly and
   * never touches `TenantSequence`, so the counter did not exist, the upsert's
   * `create` branch started at 1, and the very first console-created order in
   * that company collided — permanently, because the next attempt produces 2,
   * then 3, walking up through every seeded number.
   *
   * IT IS NOT A SEED PROBLEM. Any path that writes a reference without going
   * through this function leaves the counter behind the data: a data migration,
   * a restore into a fresh row, and the CSV import that is still on the roadmap.
   * The seeds are fixed too, but the counter has to be able to heal itself or
   * the next such path re-breaks order creation.
   *
   * CATCHING THE P2002 AFTERWARDS IS NOT AVAILABLE. A unique violation aborts
   * the whole Postgres transaction, and every caller here is already inside the
   * interactive transaction `withTenant` opened — so the recovery has to happen
   * BEFORE the insert, which is what this does.
   *
   * The race is closed by the upsert itself: two callers may both see no
   * counter and both compute the same start, but one INSERT wins and the other
   * conflicts into `update`, which increments. Neither observes a stale value.
   */
  const existing = await db.tenantSequence.findUnique({
    where: { tenantId_name: { tenantId, name } },
    select: { value: true },
  });

  const start = existing ? 1 : (await highestExisting(db, name)) + 1;

  const row = await db.tenantSequence.upsert({
    where: { tenantId_name: { tenantId, name } },
    create: { tenantId, name, value: start },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return `${PREFIX[name]}-${String(row.value).padStart(WIDTH[name], "0")}`;
}

/**
 * The largest number already in use for this counter, or 0.
 *
 * Read ONLY when the counter row is absent — the once-per-tenant case — so the
 * ordinary path stays a single atomic statement. It deliberately does not fall
 * back to `count()`: D-05.2 removed counting precisely because deleted rows make
 * a count smaller than the highest number in use, and that is the collision this
 * whole function exists to prevent.
 */
async function highestExisting(db: TenantDb, name: SequenceName): Promise<number> {
  const prefix = `${PREFIX[name]}-`;
  const rows =
    name === "order"
      ? await db.fulfillmentOrder.findMany({
          where: { reference: { startsWith: prefix } },
          select: { reference: true },
        })
      : await db.catalogProduct.findMany({
          where: { reference: { startsWith: prefix } },
          select: { reference: true },
        });

  let highest = 0;
  for (const row of rows) {
    // Only a reference this scheme could have MINTED counts. A tenant whose
    // imported numbers are `ORD-2024-A` must not push the counter to something
    // that number happened to parse as.
    const suffix = row.reference?.slice(prefix.length) ?? "";
    if (!/^\d+$/.test(suffix)) continue;
    const value = Number(suffix);
    if (Number.isSafeInteger(value) && value > highest) highest = value;
  }
  return highest;
}

/** The prefix a given counter produces. Exported so tests can assert the shape. */
export const prefixFor = (name: SequenceName) => PREFIX[name];
