import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { parseCsv, toRecords, ORDER_DICTIONARY, IMPORT_LIMIT } from "@/lib/erp/import";
import { createOrder } from "@/lib/erp/orders";
import { normalizePhone } from "@/lib/erp/phone";
import { toDecimal } from "@/lib/erp/serialize";
import { autoAssignOnCreate } from "@/lib/erp/assign";
import { readSettings } from "@/lib/erp/settings";

export const dynamic = "force-dynamic";

/* =============================================================================
 * A back catalogue of orders, from a file — LP.19, closing R17's import.
 *
 * How a new tenant's history arrives. The legacy calls it "Shopify CSV order
 * import with a preview and dedup by external id", and the dedup is the part
 * that matters: an operator who is not sure whether the first import worked runs
 * it again, and an import that creates every row twice has doubled the
 * business's history — including every customer's lifetime counters, which are
 * append-only and cannot be walked back.
 *
 * D-LP.19.1/2/3 apply unchanged (see `lib/erp/import.ts`): the file is parsed
 * here, `mode` is required, and nothing that already exists is overwritten.
 *
 * -----------------------------------------------------------------------------
 * D-LP.19.4 — AN IMPORTED ORDER GOES THROUGH `createOrder`, NOT AROUND IT
 *
 * It is tempting to `createMany` a thousand rows. `createOrder` is what mints
 * the `reference` from `TenantSequence` and what calls `syncClientFromOrder`, so
 * bypassing it would produce orders with no number a customer can read back and
 * a customer registry that does not know they exist — which is most of what an
 * import is FOR.
 *
 * D-LP.19.5 — AN IMPORTED ORDER IS NOT A NEW ORDER
 *
 * `autoAssignOnCreate` is honoured (a tenant with auto-assignment on wants the
 * back catalogue distributed), and **no notification is raised**. `notifyNewOrder`
 * is deliberately not called: importing two years of history would push two
 * years of "new order" alerts at everybody holding `erp:orders:write`, and the
 * ka-ching LP.11 just built would fire a thousand times.
 * ========================================================================== */

const Import = z.object({
  mode: z.enum(["preview", "commit"]),
  csv: z.string().min(1).max(8_000_000),
  source: z.string().trim().max(120).optional(),
  columns: z.record(z.string(), z.string()).optional(),
  /** Which sales channel these came from, if any. Stamped for provenance. */
  salesChannelId: z.string().trim().max(64).optional(),
});

export const POST = tenantRoute("erp:orders:write", async ({ db, req, session }) => {
  const parsed = Import.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const grid = parseCsv(parsed.data.csv);
  if (grid.length < 2) {
    return apiError(422, "EMPTY_FILE", "The file has a header row and no records under it.");
  }

  const records = toRecords(grid, ORDER_DICTIONARY, parsed.data.columns);
  if (records.length > IMPORT_LIMIT) {
    return apiError(
      422,
      "TOO_MANY_ROWS",
      `This file has ${records.length} rows; the limit is ${IMPORT_LIMIT} per import. Split it.`,
      { total: records.length, limit: IMPORT_LIMIT },
    );
  }

  const mapped = new Set(records.flatMap((r) => Object.keys(r)));
  if (!mapped.has("phone")) {
    return apiError(
      422,
      "NO_PHONE_COLUMN",
      "No column in this file was recognised as a phone number. An order with no number cannot be called, which is the whole workflow.",
      { headers: grid[0] },
    );
  }

  const tenantId = session.auth!.tenantId;
  const dryRun = parsed.data.mode === "preview";
  const source = parsed.data.source?.trim() || "import";
  const settings = dryRun ? null : await readSettings(db);

  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const skippedRows: { row: number; reason: string }[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const rowNumber = i + 2;

    /* THE DEDUP KEY. `externalId` is what the file's own system called this
     * order, and it is indexed per tenant — per tenant because two companies
     * will both receive an order numbered #1001, and a global key would make
     * the second one silently vanish.
     *
     * A file with no id column falls back to the phone plus the total, which is
     * weaker and is SAID so in the response rather than presented as a
     * guarantee: two genuine orders from one customer for the same amount would
     * be read as one. */
    const externalId = record.externalId || record.externalName || "";
    const phone = normalizePhone(record.phone);

    /* THE ID IS CHECKED BEFORE THE PHONE, and that ordering is the whole
     * handling of a Shopify export.
     *
     * Shopify repeats the order row once per LINE ITEM and leaves every
     * customer column blank on the continuation rows — so a continuation row
     * carries an id and nothing else. Checking the phone first reported those
     * rows as `no_phone` skips, which reads as a broken file rather than as the
     * normal shape of the export. Found by a test driving a two-line-item
     * order. */
    if (externalId && seenInFile.has(externalId)) {
      duplicates += 1;
      continue;
    }

    if (!phone) {
      skipped += 1;
      skippedRows.push({ row: rowNumber, reason: "no_phone" });
      continue;
    }

    const key = externalId || `${phone}:${record.price ?? ""}`;
    if (seenInFile.has(key)) {
      duplicates += 1;
      continue;
    }
    seenInFile.add(key);

    if (externalId) {
      const already = await db.fulfillmentOrder.findFirst({
        where: { externalId },
        select: { id: true },
      });
      if (already) {
        duplicates += 1;
        continue;
      }
    }

    if (dryRun) {
      created += 1;
      continue;
    }

    const price = toDecimal(record.price);
    // A date the file carried, so an imported history sits where it belongs on
    // every date filter and every analytics month. An unparseable one falls
    // back to now rather than refusing the row — an order with the wrong date
    // is recoverable, a lost order is not.
    const placed = record.createdAt ? new Date(record.createdAt) : null;
    const createdAt = placed && !Number.isNaN(placed.getTime()) ? placed : new Date();

    await createOrder(db, tenantId, {
      tenantId,
      client: record.client ?? "",
      phone: record.phone ?? phone,
      phoneNormalized: phone,
      wilaya: record.wilaya ?? "",
      commune: record.commune ?? "",
      product: record.product ?? "",
      quantity: Number(record.quantity) || 1,
      price: price ?? undefined,
      note: record.note ?? "",
      // Where it came from, on the row, so an imported order is never mistaken
      // for one a customer placed here.
      source,
      externalId: externalId || null,
      externalName: record.externalName ?? "",
      ...(parsed.data.salesChannelId ? { salesChannelId: parsed.data.salesChannelId } : {}),
      // Imported history is history: it is not waiting for a confirmation call.
      status: "confirmed",
      orderType: "normal",
      createdAt,
      // D-LP.19.5 — honoured, because a tenant with auto-assignment on wants
      // the back catalogue distributed too.
      agentUserId: (await autoAssignOnCreate(db, tenantId, settings!)) ?? undefined,
    });
    created += 1;
  }

  if (!dryRun) {
    await db.auditEvent.create({
      data: {
        tenantId,
        product: "erp",
        entity: "order",
        entityId: "import",
        action: "import",
        userId: session.user.id,
        payload: { source, created, duplicates, skipped },
      },
    });
  }

  return apiOk({
    mode: parsed.data.mode,
    rows: records.length,
    created,
    duplicates,
    skipped,
    skippedRows,
    // Stated rather than assumed: without an id column the dedup is
    // phone + total, which two genuine identical orders would collide on.
    dedupBy: mapped.has("externalId") || mapped.has("externalName") ? "externalId" : "phone+total",
  });
});
