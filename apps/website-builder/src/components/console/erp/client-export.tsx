/* =============================================================================
 * The customer registry as a file — LP.10.
 *
 * A PLAIN LINK, for the reasons `OrderExportPanel` records: a download belongs
 * in the URL — shareable, bookmarkable, survives a refresh, works before
 * JavaScript, and assertable by a contract test.
 *
 * It carries the CURRENT query string, so the file is what is on screen (
 * D-LP.6.2). "The customers in Alger who have taken delivery three times" is a
 * campaign, and the whole point of the filter bar above it is that the export
 * inherits the answer rather than re-deriving it.
 * ========================================================================== */

export interface ClientExportStrings {
  readonly title: string;
  readonly hint: string;
  readonly download: string;
  /** "{n} in this view" — `{n}` is substituted. */
  readonly inView: string;
}

export function ClientExportPanel({
  params,
  s,
  total,
}: {
  readonly params: URLSearchParams;
  readonly s: ClientExportStrings;
  readonly total: number;
}) {
  const query = new URLSearchParams(params);
  // Paging is a property of the SCREEN, not of the file. An export honouring
  // `?page=3` would hand back rows 101–150 and call itself the export.
  query.delete("page");
  const href = `/api/erp/clients/export${query.toString() ? `?${query}` : ""}`;

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-client-export">
      <h2 className="text-sm font-semibold tracking-tight">{s.title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
      <a
        data-testid="client-export-link"
        href={href}
        className="mt-3 inline-block rounded-md border border-input px-3 py-1.5 text-sm font-medium"
      >
        {s.download}
        {" · "}
        {s.inView.replace("{n}", String(total))}
      </a>
    </section>
  );
}
