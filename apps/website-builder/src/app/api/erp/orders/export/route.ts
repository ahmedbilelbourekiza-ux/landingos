import { z } from "zod";

import { can } from "@landingos/auth";

import { tenantRoute, apiError } from "@/lib/api/route";
import {
  buildExport, exportWhere, isExportFormat, EXPORT_FORMATS, EXPORT_LIMIT,
  type ExportFormat, type ExportResult,
} from "@/lib/erp/export";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The order book as a file — LP.6, restoring R4.
 *
 * Excel is how a confirmed order reaches a carrier that has no API, which in
 * this market is most of them. Until this route existed a confirmed order could
 * not leave the platform by any route at all.
 *
 * TWO METHODS, ONE BUILDER.
 *
 *   GET  — a plain link carrying the SAME query string the order list uses. It
 *          is a link and not a fetch on purpose: a download belongs in the URL,
 *          so it is shareable, bookmarkable, survives a refresh and works before
 *          JavaScript. The same reasoning as `<Pager>`.
 *   POST — the ticked rows, because two hundred cuids do not belong in a query
 *          string and some proxies would truncate them. The body is a list of
 *          ids and nothing else; every id still goes through `scopedWhere`.
 *
 * WHO MAY EXPORT WHAT — two gates, and they are different questions.
 *
 * The route is `erp:orders:read` and the rows are record-scoped, so an agent
 * exports their own queue and a manager exports the book — exactly what each of
 * them already reads on screen. The `agents` format is the exception and needs
 * `erp:agents:manage`: it is a league table of confirmation rates and
 * suspicious-call counts, which is supervision data. `notifySuspiciousCall`
 * withholds the same fact from the agent it is about, for the same reason —
 * telling somebody they were flagged tells them what to change.
 * ========================================================================== */

/** Supervision data, not order data. See the note above. */
const SUPERVISION_FORMATS = new Set<ExportFormat>(["agents"]);

function fileResponse(result: ExportResult): Response {
  return new Response(result.csv, {
    status: 200,
    headers: {
      // `charset=utf-8` alongside the BOM `toCsv` writes: the header is for
      // anything fetching this over HTTP, the BOM is for Excel opening the
      // saved file, and neither covers the other.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.filename}"`,
      // A count the caller can check without parsing the body — and what the
      // POST path shows the operator, since a blob download reports nothing.
      "x-export-rows": String(result.rows),
      // An export is a snapshot of a moving book. Caching one would hand
      // somebody yesterday's orders and tell them they were today's.
      "cache-control": "no-store",
    },
  });
}

const tooMany = (total: number) =>
  apiError(
    422,
    "TOO_MANY_ROWS",
    `This export would contain ${total} orders, and the limit is ${EXPORT_LIMIT}. Narrow the filter — a date range or a status — and try again.`,
    { total, limit: EXPORT_LIMIT },
  );

const unknownFormat = (value: string | null) =>
  apiError(422, "INVALID_INPUT", `"${value ?? ""}" is not an export format.`, {
    valid: [...EXPORT_FORMATS],
  });

export const GET = tenantRoute("erp:orders:read", async ({ db, session, searchParams }) => {
  const format = searchParams.get("format");
  if (!isExportFormat(format)) return unknownFormat(format);

  if (SUPERVISION_FORMATS.has(format) && !can(session.auth!, "erp:agents:manage")) {
    return apiError(403, "FORBIDDEN", "You do not have access to this.");
  }

  const where = exportWhere(session, searchParams, format);
  const built = await buildExport(db, format, where);
  return "error" in built ? tooMany(built.total) : fileResponse(built);
});

const Selection = z.object({
  format: z.string().trim().min(1),
  // The same ceiling `POST /orders/bulk` applies, and for the same reason: a
  // list of primary keys straight from a request is the shape that invites
  // pasting ids you were never given. Scope refuses those; the cap bounds the
  // query regardless.
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
});

export const POST = tenantRoute("erp:orders:read", async ({ db, req, session }) => {
  const parsed = Selection.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { format, ids } = parsed.data;
  if (!isExportFormat(format)) return unknownFormat(format);

  if (SUPERVISION_FORMATS.has(format) && !can(session.auth!, "erp:agents:manage")) {
    return apiError(403, "FORBIDDEN", "You do not have access to this.");
  }

  // A selection is the filter, so no query string is read here. Ids outside the
  // caller's record scope resolve to nothing rather than being refused, which
  // is the same answer the list gives for a row they cannot see — a refusal
  // would confirm the row exists.
  const where = exportWhere(session, new URLSearchParams(), format, ids);
  const built = await buildExport(db, format, where);
  return "error" in built ? tooMany(built.total) : fileResponse(built);
});
