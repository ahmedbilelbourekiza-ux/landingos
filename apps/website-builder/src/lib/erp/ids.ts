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
  const row = await db.tenantSequence.upsert({
    where: { tenantId_name: { tenantId, name } },
    create: { tenantId, name, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return `${PREFIX[name]}-${String(row.value).padStart(WIDTH[name], "0")}`;
}

/** The prefix a given counter produces. Exported so tests can assert the shape. */
export const prefixFor = (name: SequenceName) => PREFIX[name];
