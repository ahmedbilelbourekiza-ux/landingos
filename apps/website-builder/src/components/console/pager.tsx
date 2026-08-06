import Link from "next/link";

import type { PageInfo } from "./filter-field";

/* =============================================================================
 * Moving through a list.
 *
 * WHY THIS EXISTS. Every ERP screen was a hard-capped first-N read — orders 50,
 * clients 50, products 100 — with no next, no page number and no total. Row 51
 * did not exist as far as the console was concerned. The legacy CRM downloaded
 * the whole book and filtered in the browser, which is slow at 5,000 orders and
 * is what PERF-02 was filed for; the platform fixed the query side properly and
 * then never built the navigation on top of it, so the data went from slow to
 * reach to impossible to reach. That is a worse outcome than the bug it
 * replaced.
 *
 * OFFSET, NOT A CURSOR — and this is a correction to the design LEGACY_PARITY
 * §6.4(b) first proposed. A cursor is the right answer for an infinite feed and
 * the wrong one here for two reasons. First, it cannot show "page 3 of 27", and
 * an operator asking how many pending orders exist is asking a business
 * question a next-arrow cannot answer. Second, and decisively, the API's own
 * `pagination()` helper is already page/pageSize — a screen paging by cursor
 * would be a SECOND vocabulary over the same rows, which is the exact failure
 * this slice exists to remove elsewhere. The scan cost of a deep offset is real
 * and is bounded by the filter bar sitting next to it.
 *
 * A SERVER COMPONENT, and links rather than buttons. Paging is navigation: it
 * belongs in the URL, so it is shareable, bookmarkable, survives a refresh, and
 * works before JavaScript. It is also why a contract test can assert it.
 * ========================================================================== */

export interface PagerStrings {
  readonly previous: string;
  readonly next: string;
  /** "Page {page} of {pages}" — `{page}` and `{pages}` are substituted. */
  readonly position: string;
  /** "{total} results" — `{total}` is substituted. */
  readonly total: string;
}

/**
 * Build a URL that keeps every other filter.
 *
 * Losing the filter on "next" is the classic defect in a pager, and it is
 * invisible in review because page 1 looks right. Copying the whole params bag
 * and replacing one key is the only version that cannot do it.
 */
function hrefFor(basePath: string, params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  if (page <= 1) next.delete("page");
  else next.set("page", String(page));
  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function Pager({
  basePath,
  params,
  info,
  s,
  testId = "pager",
}: {
  readonly basePath: string;
  readonly params: URLSearchParams;
  readonly info: PageInfo;
  readonly s: PagerStrings;
  readonly testId?: string;
}) {
  const pages = Math.max(1, Math.ceil(info.total / info.pageSize));
  const page = Math.min(Math.max(1, info.page), pages);

  // Rendered even on a single page, because the TOTAL is useful on its own —
  // "37 results" answers a question the table cannot. Only the arrows go away.
  const hasPrev = page > 1;
  const hasNext = page < pages;

  const arrow = (label: string, target: number, enabled: boolean, id: string) =>
    enabled ? (
      <Link
        href={hrefFor(basePath, params, target)}
        data-testid={id}
        className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
      >
        {label}
      </Link>
    ) : (
      <span
        data-testid={`${id}-disabled`}
        aria-disabled="true"
        className="rounded-md border border-input px-3 py-1.5 text-sm opacity-40"
      >
        {label}
      </span>
    );

  return (
    <nav
      className="mt-4 flex flex-wrap items-center gap-3"
      data-testid={testId}
      data-page={page}
      data-pages={pages}
      data-total={info.total}
      aria-label={s.position.replace("{page}", String(page)).replace("{pages}", String(pages))}
    >
      {arrow(s.previous, page - 1, hasPrev, `${testId}-prev`)}
      {arrow(s.next, page + 1, hasNext, `${testId}-next`)}
      {/* dir="ltr" and tabular-nums: a count is read left-to-right even on an
          RTL page, and the figures should not jump as the page changes. */}
      <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
        {s.position.replace("{page}", String(page)).replace("{pages}", String(pages))}
        {" · "}
        {s.total.replace("{total}", String(info.total))}
      </span>
    </nav>
  );
}
