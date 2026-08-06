import "server-only";

import type { Prisma, TenantDb } from "@landingos/db";

import { scopedWhere } from "./scope";
import { orderFilters } from "./orders";
import type { ConsoleSession } from "@/lib/console/session";

/* =============================================================================
 * Taking the order book out of the building — LP.6, restoring R4.
 *
 * Excel is how a confirmed order reaches a carrier that has no API, which in
 * this market is most of them. The legacy CRM's Export screen built four files
 * (ZR Express, Ecom Delivery, Ecotrac, and a two-sheet performance report) and
 * the order list built a fifth from the ticked rows. The platform had no CSV,
 * no XLSX and no file download anywhere, so a confirmed order could not leave
 * the system by any route.
 *
 * -----------------------------------------------------------------------------
 * D-LP.6.1 — CSV, NOT XLSX
 *
 * The three carrier files are flat column lists — CSV is their natural shape,
 * and every carrier portal and every spreadsheet reads it. XLSX would mean a
 * parser/writer dependency in the server bundle for one feature, and the only
 * thing it would buy is the report's two SHEETS, which are two files here and
 * are offered as two formats. LEGACY_PARITY R4 sizes it the same way. If a
 * carrier is ever found that refuses CSV, `toCsv` is the only function that
 * changes.
 *
 * D-LP.6.2 — THE EXPORT IS THE LIST, FILTERED THE SAME WAY
 *
 * The legacy exported `orders.filter(o => o.status === 'confirmed')` from the
 * whole book it had already downloaded, so the Export screen could not honour
 * anything the operator had filtered to on the order list — a wilaya, a date
 * window, an agent. Here the export takes the SAME query string the list does
 * and runs it through the SAME `orderFilters` and `scopedWhere`. One vocabulary
 * (D-LP.3), so an export and the screen that offered the filters cannot
 * disagree about what "confirmed orders from this week" contained.
 *
 * D-LP.6.3 — A CARRIER FILE IS CONFIRMED ORDERS, AND THE CALLER CANNOT WIDEN IT
 *
 * `status` is REMOVED from the parameters for the three carrier formats and
 * `confirmed` is ANDed in afterwards. Handing a courier an order nobody has
 * confirmed is a real delivery attempt against a customer who never agreed to
 * one. Every other filter still applies, so "confirmed orders for Alger from
 * yesterday, as a ZR file" works and "pending orders as a ZR file" cannot.
 * ========================================================================== */

export const EXPORT_FORMATS = ["zr", "ecom", "ecotrac", "orders", "agents"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const isExportFormat = (value: string | null | undefined): value is ExportFormat =>
  Boolean(value) && (EXPORT_FORMATS as readonly string[]).includes(value!);

/** The three that go to a delivery company, and therefore mean "confirmed". */
const CARRIER_FORMATS = new Set<ExportFormat>(["zr", "ecom", "ecotrac"]);

/**
 * How many rows one export may carry.
 *
 * An export is the one read on this surface with no page, and it runs inside
 * the transaction `withTenant` opened (TX_OPTIONS: 15s). A cap is therefore not
 * optional — but a SILENT cap is the defect LP.3 spent a slice removing, where
 * row 51 simply did not exist. Over the limit is a named refusal telling the
 * operator to narrow the filter, never a short file that looks complete.
 */
export const EXPORT_LIMIT = 10_000;

/* -----------------------------------------------------------------------------
 * CSV
 * -------------------------------------------------------------------------- */

/**
 * Characters that make Excel and LibreOffice treat a cell as a FORMULA.
 *
 * This is not hypothetical here. `client`, `product` and `note` arrive from a
 * storefront checkout and from channel webhooks — a stranger types them — and
 * the file is opened by an operator on their own machine. A name of
 * `=HYPERLINK("http://…"&A1)` exfiltrates the row it sits next to; `=cmd|…`
 * has been a working command-execution vector in Excel for years.
 *
 * The legacy CRM was injectable in exactly the same way through
 * `XLSX.utils.json_to_sheet`, so this is a deliberate improvement rather than a
 * port.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Numbers are safe and must not be mangled: a leading `-` is a negative total. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * One CSV cell: neutralised, then quoted when it has to be.
 *
 * The apostrophe is the standard neutraliser — Excel shows the text and does not
 * evaluate it. It is applied only to values that are not plainly numeric, so a
 * price of `-500` stays `-500` and a customer called `=SUM(A1)` becomes
 * `'=SUM(A1)`.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Rows to a CSV document.
 *
 * CRLF because that is what RFC 4180 says and what Excel on Windows expects,
 * and a BOM because without one Excel reads the file as the machine's ANSI
 * codepage: every accented wilaya renders as mojibake and every Arabic customer
 * name as question marks. The operator's conclusion in both cases is that the
 * export is broken.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** `ZR_Export_2026-08-06.csv` — the legacy's own naming, in CSV. */
export function exportFilename(format: ExportFormat, now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const prefix: Record<ExportFormat, string> = {
    zr: "ZR_Export",
    ecom: "Ecom_Export",
    ecotrac: "Ecotrac_Export",
    orders: "CRM_Report_Orders",
    agents: "CRM_Report_Agents",
  };
  return `${prefix[format]}_${stamp}.csv`;
}

/* -----------------------------------------------------------------------------
 * The rows
 * -------------------------------------------------------------------------- */

/**
 * Everything any format needs, read once.
 *
 * Wider than `ORDER_LIST_SELECT` in two places and narrower in several. The
 * additions are the ones the list does not render and the carriers require:
 * `shippingNote` — the courier's delivery instruction, which is what the ERP's
 * `Note` column actually held — and the calls, for the report's note, call
 * count and suspicious count.
 */
const EXPORT_SELECT = {
  id: true, reference: true, externalName: true,
  client: true, phone: true, phoneNormalized: true,
  wilaya: true, commune: true,
  product: true, productVariant: true, quantity: true, price: true,
  status: true, agentUserId: true,
  carrierCode: true, deliveryStatus: true, trackingNumber: true,
  shippingNote: true, note: true,
  createdAt: true,
} satisfies Prisma.FulfillmentOrderSelect;

type ExportOrder = Prisma.FulfillmentOrderGetPayload<{ select: typeof EXPORT_SELECT }>;

interface ExportContext {
  /** userId → the name a person recognises. */
  readonly agentNames: ReadonlyMap<string, string>;
  /** carrier code → the carrier's name. */
  readonly carrierNames: ReadonlyMap<string, string>;
  /** orderId → what its calls say. */
  readonly calls: ReadonlyMap<string, { total: number; suspicious: number; latestNote: string }>;
}

/** The local `0X…` form, which is what an Algerian carrier's importer expects. */
const localPhone = (order: ExportOrder) => order.phoneNormalized || order.phone || "";

/** `Product - Variant`, the way the ERP wrote it into every carrier file. */
const productLabel = (order: ExportOrder) =>
  order.productVariant ? `${order.product ?? ""} - ${order.productVariant}` : (order.product ?? "");

/** The courier's instruction, then the general note — the ERP's own precedence. */
const deliveryNote = (order: ExportOrder) => order.shippingNote || order.note || "";

/** Money as its stored decimal STRING. A JS float here is M-06 undone. */
const money = (value: Prisma.Decimal | null) => (value ? value.toString() : "0");

/** ISO-ish and unambiguous. `fmt()` in the ERP was locale-formatted, which sorts wrongly. */
function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

interface Sheet {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

/**
 * The four column sets, ported verbatim from the ERP's four builders.
 *
 * The headers ARE the contract: a carrier's importer matches on them, so they
 * are the legacy's strings exactly — French, accents and all — and not
 * translated. A localised header is a file the carrier rejects.
 */
function buildSheet(format: ExportFormat, orders: readonly ExportOrder[], ctx: ExportContext): Sheet {
  switch (format) {
    case "zr":
      return {
        headers: ["Nom", "Tel", "Tel2", "Wilaya", "Commune", "Produit", "Qte", "Prix", "Note"],
        rows: orders.map((o) => [
          o.client ?? "", localPhone(o), "", o.wilaya ?? "", o.commune ?? "",
          productLabel(o), o.quantity ?? 1, money(o.price), deliveryNote(o),
        ]),
      };

    case "ecom":
      return {
        headers: ["Nom", "Telephone", "Wilaya", "Commune", "Produit", "Quantite", "Prix", "Remarque"],
        rows: orders.map((o) => [
          o.client ?? "", localPhone(o), o.wilaya ?? "", o.commune ?? "",
          productLabel(o), o.quantity ?? 1, money(o.price), deliveryNote(o),
        ]),
      };

    case "ecotrac":
      // No quantity column, which is Ecotrac's own shape and not an omission.
      return {
        headers: ["Nom Complet", "Mobile", "Wilaya", "Commune", "Designation", "Montant", "Note"],
        rows: orders.map((o) => [
          o.client ?? "", localPhone(o), o.wilaya ?? "", o.commune ?? "",
          productLabel(o), money(o.price), deliveryNote(o),
        ]),
      };

    case "orders":
      return {
        headers: [
          "ID", "Client", "Phone", "Product", "Variant", "Qty", "Price", "Wilaya",
          "Agent", "Status", "LatestNote", "Calls", "Suspicious",
          "Delivery", "DeliveryStatus", "Tracking", "Date",
        ],
        rows: orders.map((o) => {
          const calls = ctx.calls.get(o.id);
          return [
            // The number a human reads back, then the external one, then the
            // key. A cuid in a spreadsheet column named ID is not an id anybody
            // can use.
            o.reference ?? o.externalName ?? o.id,
            o.client ?? "", o.phone ?? "", o.product ?? "", o.productVariant ?? "",
            o.quantity ?? 1, money(o.price), o.wilaya ?? "",
            o.agentUserId ? (ctx.agentNames.get(o.agentUserId) ?? "") : "",
            // The status KEY, not a label. It is the same vocabulary the filter
            // bar and the API use, it is stable across the three languages this
            // console ships in, and a file whose contents change with the
            // reader's locale cannot be compared with last month's.
            o.status ?? "",
            calls?.latestNote ?? "", calls?.total ?? 0, calls?.suspicious ?? 0,
            o.carrierCode ? (ctx.carrierNames.get(o.carrierCode) ?? o.carrierCode) : "",
            o.deliveryStatus ?? "", o.trackingNumber ?? "", stamp(o.createdAt),
          ];
        }),
      };

    case "agents": {
      // Grouped over the SAME filtered, scoped set as every other format, so
      // "this week's confirmation rate" is this week's.
      const byAgent = new Map<string, { total: number; confirmed: number; suspicious: number }>();
      for (const order of orders) {
        if (!order.agentUserId) continue;
        const row = byAgent.get(order.agentUserId) ?? { total: 0, confirmed: 0, suspicious: 0 };
        row.total += 1;
        if (order.status === "confirmed") row.confirmed += 1;
        row.suspicious += ctx.calls.get(order.id)?.suspicious ?? 0;
        byAgent.set(order.agentUserId, row);
      }
      return {
        headers: ["Agent", "Total", "Confirmed", "Rate", "Suspicious"],
        rows: [...byAgent.entries()]
          .map(([userId, r]) => [
            ctx.agentNames.get(userId) ?? userId,
            r.total,
            r.confirmed,
            // A percentage with the sign, because the column is read by a person
            // comparing agents rather than by an importer.
            `${r.total ? Math.round((r.confirmed / r.total) * 100) : 0}%`,
            r.suspicious,
          ])
          .sort((a, b) => Number(b[1]) - Number(a[1])),
      };
    }
  }
}

/* -----------------------------------------------------------------------------
 * Building one
 * -------------------------------------------------------------------------- */

export type ExportRefusal = "TOO_MANY_ROWS";

export interface ExportResult {
  readonly filename: string;
  readonly csv: string;
  readonly rows: number;
}

/**
 * The `where` an export runs against.
 *
 * Exported so the screen can COUNT what a link would produce without building
 * it — a "download" button that turns out to be empty, or refused for being too
 * large, is a click that teaches nothing.
 */
export function exportWhere(
  session: ConsoleSession,
  params: URLSearchParams,
  format: ExportFormat,
  ids?: readonly string[],
): Prisma.FulfillmentOrderWhereInput {
  // An explicit selection is the filter. It still goes through `scopedWhere`,
  // so a pasted id outside the caller's scope resolves to nothing — the same
  // property `POST /orders/bulk` holds, for the same reason.
  //
  // AND `confirmed` STILL APPLIES TO A CARRIER FILE. Ticking rows is a
  // deliberate act, and the rule below is not about intent: handing a courier
  // an order nobody has confirmed is a real delivery attempt against a customer
  // who never agreed to one. An operator who wants that order collected
  // confirms it first.
  if (ids?.length) {
    const selected = scopedWhere(session, { id: { in: [...ids] } });
    return CARRIER_FORMATS.has(format) ? { AND: [selected, { status: "confirmed" }] } : selected;
  }

  if (!CARRIER_FORMATS.has(format)) return scopedWhere(session, orderFilters(params));

  // D-LP.6.3. `status` is dropped rather than contradicted: ANDing `confirmed`
  // onto a caller's `status=pending` would answer with an empty file, which
  // reads as "there are none" when the truth is "that is not a question this
  // file can answer".
  const narrowed = new URLSearchParams(params);
  narrowed.delete("status");
  return { AND: [scopedWhere(session, orderFilters(narrowed)), { status: "confirmed" }] };
}

/**
 * Read the rows and render the file.
 *
 * The count comes first and on its own. Building ten thousand rows and then
 * discovering they were eleven thousand wastes the transaction this is running
 * inside, and the caller has to be told the real number to know how much to
 * narrow by.
 */
export async function buildExport(
  db: TenantDb,
  format: ExportFormat,
  where: Prisma.FulfillmentOrderWhereInput,
): Promise<ExportResult | { error: ExportRefusal; total: number }> {
  const total = await db.fulfillmentOrder.count({ where });
  if (total > EXPORT_LIMIT) return { error: "TOO_MANY_ROWS", total };

  const orders = await db.fulfillmentOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: EXPORT_LIMIT,
    select: EXPORT_SELECT,
  });

  const ctx = await context(db, format, orders);
  const sheet = buildSheet(format, orders, ctx);

  return {
    filename: exportFilename(format),
    csv: toCsv(sheet.headers, sheet.rows),
    // The ROWS in the file, which for `agents` is one per agent and not one per
    // order. A caller checking "did I get everything" needs the number that is
    // actually in the file.
    rows: sheet.rows.length,
  };
}

/**
 * The lookups a format needs, and none it does not.
 *
 * The carrier files name a customer and a place and nothing about this company,
 * so they skip all three queries. The report needs the calls, which is the
 * expensive one — grouped, never joined per row, because joining call history
 * per order is what made the ERP's list quadratic.
 */
async function context(
  db: TenantDb,
  format: ExportFormat,
  orders: readonly ExportOrder[],
): Promise<ExportContext> {
  const empty: ExportContext = { agentNames: new Map(), carrierNames: new Map(), calls: new Map() };
  if (CARRIER_FORMATS.has(format) || orders.length === 0) return empty;

  const [members, carriers, calls] = await Promise.all([
    db.membership.findMany({ select: { userId: true, user: { select: { name: true, email: true } } } }),
    db.carrier.findMany({ select: { code: true, name: true } }),
    db.orderCall.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
      orderBy: [{ orderId: "asc" }, { time: "asc" }, { id: "asc" }],
      select: { orderId: true, suspicious: true, note: true },
    }),
  ]);

  const byOrder = new Map<string, { total: number; suspicious: number; latestNote: string }>();
  for (const call of calls) {
    const row = byOrder.get(call.orderId) ?? { total: 0, suspicious: 0, latestNote: "" };
    row.total += 1;
    if (call.suspicious) row.suspicious += 1;
    // The LATEST note, which is what an operator is looking for — the calls are
    // read oldest-first, so each one with a note replaces the one before it.
    if (call.note) row.latestNote = call.note;
    byOrder.set(call.orderId, row);
  }

  return {
    agentNames: new Map(members.map((m) => [m.userId, m.user.name || m.user.email])),
    carrierNames: new Map(
      carriers.filter((c) => c.code).map((c) => [c.code!, c.name ?? c.code!]),
    ),
    calls: byOrder,
  };
}
