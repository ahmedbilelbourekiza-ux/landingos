import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import {
  parseCsv, toRecords, importClients, CLIENT_DICTIONARY, IMPORT_LIMIT,
} from "@/lib/erp/import";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The customer registry, inbound — LP.19, closing R5.
 *
 * The schema has carried five `imported*` columns, an `importedSource` and an
 * `importedAt` since M-06 — declared, indexed, and rendered by LP.10's customer
 * screen — and **nothing could write any of them**. A new tenant's history
 * arrives as a file, and there was no door for it.
 *
 * D-LP.19.1: the FILE is parsed here, not in a browser. D-LP.19.2: preview and
 * commit are one request with a required `mode`. D-LP.19.3: an import never
 * overwrites a real value. All three are explained in `lib/erp/import.ts`.
 *
 * `erp:clients:write` — the SENSITIVE permission LP.10 added. Loading a
 * spreadsheet into the customer registry is at least as consequential as
 * correcting one record, and a role that could import without being able to read
 * the list would be an incoherent grant.
 * ========================================================================== */

const Import = z.object({
  /** REQUIRED. There is no default — see D-LP.19.2. */
  mode: z.enum(["preview", "commit"]),
  /** The file, as text. */
  csv: z.string().min(1).max(8_000_000),
  /** Where it came from. Stamped on `importedSource` and shown on the record. */
  source: z.string().trim().max(120).optional(),
  /** Header → field, for a spreadsheet whose columns this cannot guess. */
  columns: z.record(z.string(), z.string()).optional(),
});

export const POST = tenantRoute("erp:clients:write", async ({ db, req, session }) => {
  const parsed = Import.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const grid = parseCsv(parsed.data.csv);
  if (grid.length < 2) {
    // A header with no rows under it is a file somebody exported with a filter
    // applied. Saying so beats "0 created", which reads as a bug in the import.
    return apiError(422, "EMPTY_FILE", "The file has a header row and no records under it.");
  }

  const records = toRecords(grid, CLIENT_DICTIONARY, parsed.data.columns);

  // Refused BY NAME above the limit, never silently truncated (the LP.3 rule).
  // An operator who imports 12,000 customers and is told "5,000 created" has
  // 7,000 they believe are in the system.
  if (records.length > IMPORT_LIMIT) {
    return apiError(
      422,
      "TOO_MANY_ROWS",
      `This file has ${records.length} rows; the limit is ${IMPORT_LIMIT} per import. Split it.`,
      { total: records.length, limit: IMPORT_LIMIT },
    );
  }

  // A file whose phone column was not recognised produces records with no
  // `phone` at all, and every row would be skipped with `no_phone` — which
  // reads as "the data is bad" rather than "the mapping is wrong". Named
  // separately so the operator maps the column instead of editing the file.
  const mapped = new Set(records.flatMap((r) => Object.keys(r)));
  if (!mapped.has("phone")) {
    return apiError(
      422,
      "NO_PHONE_COLUMN",
      "No column in this file was recognised as a phone number, which is the only identity key a customer import has. Map it explicitly.",
      { headers: grid[0] },
    );
  }

  const dryRun = parsed.data.mode === "preview";
  const outcome = await importClients(
    db,
    session.auth!.tenantId,
    records,
    parsed.data.source?.trim() || "import",
    dryRun,
  );

  if (!dryRun) {
    /* Recorded, because this is the one write on the customer surface that can
     * touch thousands of rows at once, and "where did these 900 customers come
     * from" needs an answer. The counts, never the contents. */
    await db.auditEvent.create({
      data: {
        tenantId: session.auth!.tenantId,
        product: "erp",
        entity: "client",
        entityId: "import",
        action: "import",
        userId: session.user.id,
        payload: {
          source: parsed.data.source?.trim() || "import",
          created: outcome.created,
          merged: outcome.merged,
          skipped: outcome.skipped,
        },
      },
    });
  }

  return apiOk({ mode: parsed.data.mode, rows: records.length, ...outcome });
});
