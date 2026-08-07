import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { normalizePhone } from "./phone";
import { toDecimal } from "./serialize";

/* =============================================================================
 * Bringing a spreadsheet in — LP.19, restoring R5's fourth feature and R17's.
 *
 * A new tenant's history arrives as a file. Until this slice the schema carried
 * five `imported*` columns, an `importedSource` and an `importedAt` — declared in
 * M-06, rendered by LP.10's customer screen — and **nothing could write any of
 * them**. The registry could be exported and not imported, which is half a round
 * trip.
 *
 * -----------------------------------------------------------------------------
 * D-LP.19.1 — THE FILE IS PARSED ON THE SERVER, NOT IN THE BROWSER
 *
 * The legacy parses the CSV in `index.html`, maps its columns there, and posts
 * "clean records" to an endpoint that trusts them. That is a second
 * implementation of the format living where nothing tests it, and it makes the
 * API unusable by anything except that one page — a migration script, a support
 * engineer with `curl`, a future mobile client all have to re-implement the
 * parser to talk to it.
 *
 * Here the route takes the FILE. One parser, contract-tested, and the preview
 * and the commit see byte-for-byte the same rows — which is the property a
 * preview is worth having for.
 *
 * D-LP.19.2 — A PREVIEW AND A COMMIT ARE THE SAME REQUEST WITH A DIFFERENT MODE
 *
 * The legacy has `/import/preview` and `/import` as two endpoints, and two
 * endpoints is two chances for the preview to describe something the commit does
 * not do. `mode` is REQUIRED — there is no default — because the failure mode of
 * a defaulted `commit` is a spreadsheet written into a live registry by somebody
 * who meant to look at it first.
 *
 * D-LP.19.3 — AN IMPORT NEVER OVERWRITES A REAL VALUE
 *
 * Ported verbatim from `importClientRecord`, and it is the whole safety of the
 * feature:
 *
 *   - identity fields (name, wilaya, commune, address) are filled ONLY where the
 *     stored value is blank. A real value is never replaced by an imported one.
 *   - the `imported*` figures are written ONCE, on the first import that ever
 *     touches a client, and never again — "never overwrite" applies to imported
 *     data as much as to observed data.
 *   - the LIVE counters (`totalOrders`, `deliveredOrders`, `totalSpent`, …) are
 *     never touched at all. They are the sum of order events, and this file is
 *     not an order event.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * Reading a CSV
 * -------------------------------------------------------------------------- */

/**
 * RFC 4180, including the parts people get wrong.
 *
 * A real parser rather than `split(",")`, because half of what a customer file
 * contains is quoting: an address with a comma, a name with an apostrophe, a
 * note with an embedded newline. A splitter agrees with a broken writer and
 * silently shifts every column after the first quoted comma.
 *
 * `\r\n`, `\n` and a lone `\r` are all line endings — a file exported from Excel
 * on Windows, from LibreOffice on Linux and from an old Mac tool all land here.
 * A leading BOM is stripped: our own export writes one (Excel needs it), so a
 * file exported here and re-imported here would otherwise arrive with the first
 * header named `﻿Name`.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted cell is one literal quote.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      // Only end the row on the FIRST character of the sequence, so `\r\n`
      // does not produce an empty row between every line.
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }

  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  // A trailing newline produces one empty row; so does a blank line in the
  // middle of a file somebody edited by hand. Neither is a record.
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Normalise a header for matching: case, spaces, punctuation and accents out. */
function headerKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Header → field, for the columns this import understands.
 *
 * Both the English names our own export writes AND the French ones a local
 * spreadsheet carries, because the two files an operator has to hand are "the
 * one I exported from here" and "the one the old system gave me". Matching only
 * the first would make the round trip work and the actual migration fail.
 */
const CLIENT_HEADERS: Record<string, string> = {
  name: "name", nom: "name", client: "name", customer: "name", fullname: "name",
  phone: "phone", telephone: "phone", tel: "phone", mobile: "phone", numero: "phone",
  wilaya: "wilaya", province: "wilaya", state: "wilaya",
  commune: "commune", city: "commune", ville: "commune",
  address: "address", adresse: "address",
  totalorders: "totalOrders", commandes: "totalOrders", orders: "totalOrders",
  confirmed: "confirmedOrders", confirmedorders: "confirmedOrders", confirmees: "confirmedOrders",
  cancelled: "cancelledOrders", cancelledorders: "cancelledOrders", annulees: "cancelledOrders",
  delivered: "deliveredOrders", deliveredorders: "deliveredOrders", livrees: "deliveredOrders",
  totalspent: "totalSpent", spent: "totalSpent", montant: "totalSpent", total: "totalSpent",
};

const ORDER_HEADERS: Record<string, string> = {
  // Shopify's own export column names first — R17 names that file specifically.
  name: "externalName", orderid: "externalId", id: "externalId",
  billingname: "client", shippingname: "client", customer: "client", client: "client", nom: "client",
  phone: "phone", billingphone: "phone", shippingphone: "phone", telephone: "phone", tel: "phone",
  shippingprovince: "wilaya", province: "wilaya", wilaya: "wilaya",
  shippingcity: "commune", city: "commune", commune: "commune", ville: "commune",
  shippingaddress1: "address", address: "address", adresse: "address",
  lineitemname: "product", product: "product", produit: "product",
  lineitemquantity: "quantity", quantity: "quantity", qty: "quantity", quantite: "quantity",
  total: "price", totalprice: "price", price: "price", prix: "price", montant: "price",
  createdat: "createdAt", date: "createdAt",
  note: "note", notes: "note",
};

/**
 * Turn a parsed grid into field-keyed records.
 *
 * An explicit `columns` override wins over the automatic mapping, because a
 * spreadsheet from a system nobody here has seen will have headers this file
 * cannot guess — and refusing that file would make the feature useless exactly
 * when it is needed. The override is a header → field map, so the caller names
 * their columns rather than counting them.
 *
 * A header that maps to nothing is IGNORED rather than refused. Real exports
 * carry a dozen columns nobody wants; refusing the file over "Accepts Marketing"
 * would be a wall in front of a migration.
 */
export function toRecords(
  grid: string[][],
  dictionary: Record<string, string>,
  columns?: Record<string, string>,
): Record<string, string>[] {
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => h.trim());
  const fields = headers.map((h) => columns?.[h] ?? dictionary[headerKey(h)] ?? null);

  return grid.slice(1).map((row) => {
    const record: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (!field) return;
      const value = (row[i] ?? "").trim();
      // First non-empty wins: a Shopify export repeats `Name` on every line-item
      // row and leaves the customer columns blank on all but the first.
      if (value && !record[field]) record[field] = value;
    });
    return record;
  });
}

export const CLIENT_DICTIONARY = CLIENT_HEADERS;
export const ORDER_DICTIONARY = ORDER_HEADERS;

/**
 * How many rows one import may carry.
 *
 * The whole file is read into memory, parsed, and written inside the
 * transaction `withTenant` opened (15s). A cap is not optional — and a SILENT
 * cap is the defect LP.3 spent a slice removing. Over the limit is a named
 * refusal telling the operator to split the file.
 */
export const IMPORT_LIMIT = 5_000;

/* -----------------------------------------------------------------------------
 * Merging a customer
 * -------------------------------------------------------------------------- */

export interface ImportOutcome {
  created: number;
  merged: number;
  skipped: number;
  /** Per row, so a 400-row file with three bad numbers names those three. */
  skippedRows: { row: number; reason: string }[];
}

/** `''` when the stored value is genuinely blank, so the import may fill it. */
const blank = (value: string | null | undefined) => !value || !value.trim();

const int = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

/**
 * Merge one parsed row into the registry.
 *
 * See D-LP.19.3 for the three rules. `dryRun` walks the identical path and
 * writes nothing, which is what makes the preview trustworthy: it is not a
 * second implementation guessing what the commit would do.
 */
export async function importClientRecord(
  db: TenantDb,
  tenantId: string,
  record: Record<string, string>,
  source: string,
  dryRun: boolean,
): Promise<"created" | "merged" | { skipped: string }> {
  const phone = normalizePhone(record.phone);
  // Phone is the only identity key this system has, and an import cannot invent
  // one. A row without it is skipped by NAME rather than given a placeholder,
  // which would produce a customer nobody can ring and a dedup key that
  // collides with the next such row.
  if (!phone) return { skipped: "no_phone" };

  const existing = await db.client.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
    select: {
      id: true, name: true, wilaya: true, commune: true, address: true,
      importedSource: true,
    },
  });

  if (!existing) {
    if (!dryRun) {
      await db.client.create({
        data: {
          tenantId,
          phone,
          phoneDisplay: record.phone ?? phone,
          name: record.name ?? "",
          wilaya: record.wilaya ?? "",
          commune: record.commune ?? "",
          address: record.address ?? "",
          // The LIVE counters start at zero and stay there until an order
          // event moves them. The imported figures are their own columns.
          importedTotalOrders: int(record.totalOrders),
          importedConfirmedOrders: int(record.confirmedOrders),
          importedCancelledOrders: int(record.cancelledOrders),
          importedDeliveredOrders: int(record.deliveredOrders),
          importedTotalSpent: toDecimal(record.totalSpent) ?? new Prisma.Decimal(0),
          importedSource: source,
          importedAt: new Date(),
        },
      });
    }
    return "created";
  }

  if (!dryRun) {
    // Identity: fill the blanks, never replace a real value.
    const identity = {
      name: blank(existing.name) ? (record.name ?? "") : existing.name!,
      wilaya: blank(existing.wilaya) ? (record.wilaya ?? "") : existing.wilaya!,
      commune: blank(existing.commune) ? (record.commune ?? "") : existing.commune!,
      address: blank(existing.address) ? (record.address ?? "") : existing.address!,
    };

    // The imported figures are written ONCE, ever. A second import must not
    // double them, and `importedSource` is the marker the legacy used.
    const firstImport = blank(existing.importedSource);

    await db.client.update({
      where: { id: existing.id },
      data: {
        ...identity,
        ...(firstImport
          ? {
              importedTotalOrders: int(record.totalOrders),
              importedConfirmedOrders: int(record.confirmedOrders),
              importedCancelledOrders: int(record.cancelledOrders),
              importedDeliveredOrders: int(record.deliveredOrders),
              importedTotalSpent: toDecimal(record.totalSpent) ?? new Prisma.Decimal(0),
              importedSource: source,
              importedAt: new Date(),
            }
          : {}),
      },
    });
  }

  return "merged";
}

/**
 * Run a whole file.
 *
 * Rows sharing a phone WITHIN one file count as merges after the first — an
 * estimate in preview mode and the literal truth in commit mode, since the
 * first one creates the row the rest merge into. The legacy documented the same
 * approximation and it is the honest one: a preview is a preview.
 */
export async function importClients(
  db: TenantDb,
  tenantId: string,
  records: Record<string, string>[],
  source: string,
  dryRun: boolean,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { created: 0, merged: 0, skipped: 0, skippedRows: [] };
  const seen = new Set<string>();

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    // In dry-run mode the row is not written, so a duplicate inside the file
    // would be counted as a second creation without this.
    const phone = normalizePhone(record.phone);
    const duplicateInFile = Boolean(phone) && seen.has(phone!);
    if (phone) seen.add(phone);

    const result = await importClientRecord(db, tenantId, record, source, dryRun);

    if (typeof result === "object") {
      outcome.skipped += 1;
      // +2: one for the header row, one because a person counts from 1.
      outcome.skippedRows.push({ row: i + 2, reason: result.skipped });
    } else if (result === "created" && !duplicateInFile) {
      outcome.created += 1;
    } else {
      outcome.merged += 1;
    }
  }

  return outcome;
}
