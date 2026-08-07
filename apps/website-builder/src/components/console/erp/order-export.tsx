import { EXPORT_FORMATS, type ExportFormat } from "@/lib/erp/export";

/* =============================================================================
 * Getting the order book out — LP.6.
 *
 * ON THE ORDER LIST, NOT ON A SCREEN OF ITS OWN, and that is the one place this
 * deliberately differs from the legacy CRM.
 *
 * The ERP had an Export page with four cards, and because it sat somewhere else
 * it could only ever export "every confirmed order" — whatever the operator had
 * filtered to on the order list was not a thing that page could see. Here the
 * links carry the CURRENT query string, so the file is what is on screen: this
 * wilaya, this week, this agent. That is the same principle D-LP.3 applied to
 * the filter bar, and it also means no new navigation item — which
 * `packages/product-registry` would be right to refuse for something that is an
 * action on a list rather than a place.
 *
 * PLAIN LINKS, not buttons that fetch. A download belongs in the URL: shareable,
 * bookmarkable, survives a refresh, works before JavaScript, and assertable by a
 * contract test. Same reasoning as `<Pager>`.
 * ========================================================================== */

export interface ExportStrings {
  readonly title: string;
  readonly hint: string;
  /** "{n} confirmed" — `{n}` is substituted. */
  readonly confirmed: string;
  /** "{n} in this view" — `{n}` is substituted. */
  readonly inView: string;
  readonly formats: Readonly<Record<ExportFormat, string>>;
}

/** The three that go to a delivery company; the two that are a report. */
const CARRIER_FORMATS: readonly ExportFormat[] = ["zr", "ecom", "ecotrac"];

export function OrderExportPanel({
  params,
  s,
  confirmedCount,
  filteredTotal,
  /** True only when `erp:agents:manage` is — the same gate the route checks. */
  maySeeAgentReport,
}: {
  readonly params: URLSearchParams;
  readonly s: ExportStrings;
  readonly confirmedCount: number;
  readonly filteredTotal: number;
  readonly maySeeAgentReport: boolean;
}) {
  const href = (format: ExportFormat) => {
    const query = new URLSearchParams(params);
    // Paging is a property of the SCREEN, not of the file. An export that
    // honoured `?page=3` would hand back rows 101–150 and call itself the
    // export, which is the silent-truncation defect LP.3 removed.
    query.delete("page");
    // A carrier file is confirmed orders by definition (D-LP.6.3) and the route
    // drops this parameter anyway; dropping it here too keeps the link honest
    // about what it will produce.
    if (CARRIER_FORMATS.includes(format)) query.delete("status");
    query.set("format", format);
    return `/api/erp/orders/export?${query.toString()}`;
  };

  // D-06.2. The route refuses `agents` to anybody without `erp:agents:manage` —
  // it is a league table of confirmation rates and suspicious-call counts — so
  // the link is absent rather than disabled.
  const offered = EXPORT_FORMATS.filter((f) => f !== "agents" || maySeeAgentReport);

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="erp-order-export">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{s.title}</h2>
        {/* What the links would actually produce, before anybody clicks one. A
            download that turns out to be empty is a click that teaches nothing,
            and the ERP's own export screen showed the confirmed count for the
            same reason. */}
        <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
          <span data-testid="export-confirmed-count" data-count={confirmedCount}>
            {s.confirmed.replace("{n}", String(confirmedCount))}
          </span>
          {" · "}
          <span data-testid="export-filtered-count" data-count={filteredTotal}>
            {s.inView.replace("{n}", String(filteredTotal))}
          </span>
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {offered.map((format) => (
          <a
            key={format}
            href={href(format)}
            // `download` is a hint; the route's Content-Disposition is what
            // actually names the file, because only the server knows the date
            // it stamped into it.
            download
            data-testid={`export-${format}`}
            data-format={format}
            className="ui-btn ui-btn-default tap"
          >
            {s.formats[format]}
          </a>
        ))}
      </div>
    </section>
  );
}
