import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState } from "./ui/primitives";

/* =============================================================================
 * The console's table — UI.12.
 *
 * Extracted the moment a second screen needed one, not before. Every product's
 * list screen renders through this, which is most of what makes the ERP's
 * tables look like the builder's.
 *
 * ERP operators spend their day here, so this is the component where the
 * modernisation has the most to buy. Six things it now does that it did not,
 * and each is a finding in UI_UX_AUDIT §4:
 *
 *   **UX-20 — the headers sort.** `orderSort` has read `?sort=`/`?dir=` since
 *   Phase 5 and nothing ever set them: an operator could not sort the order
 *   book by value or by date, though the query always could. The header is a
 *   LINK, like the pager, so sorting lives in the URL — bookmarkable, shareable,
 *   working before JavaScript, and assertable by a contract test. A column
 *   offers a sort only where the screen hands it a `sortKey`, and the screens
 *   take those from `ORDER_SORT_FIELDS`, which lives in the module that
 *   validates them (D-LP.3).
 *
 *   **UX-21 — the header sticks.** Fifty rows is roughly 3,000px of scroll and
 *   nine columns of which four are money or counts; by row 12 the operator was
 *   reading unlabelled numbers. The table gets its own capped scroll region
 *   from `md` up so the header can stick to something — on a phone it scrolls
 *   with the page, because a nested scroll region on a small screen is worse
 *   than the problem.
 *
 *   **UX-22 — rows respond.** A hover tint, and a SELECTED tint driven by
 *   `has-[:checked]` so ticking a box changes the row without a line of
 *   JavaScript and without a second copy of what is ticked.
 *
 *   **UX-24 — density is a choice.** See `density-toggle.tsx`.
 *
 *   **UX-25 — the scroll edges are visible.** A wide table simply ended, with
 *   no sign that *status* and *actions* were off-screen.
 *
 *   **UX-26/28 — semantics and honest emptiness.** `scope="col"`, `aria-sort`, a
 *   caption, and an empty state that distinguishes "nothing yet" from "nothing
 *   matched" — the same sentence for both told an operator filtering to
 *   `?status=cancelled` that they had no orders at all.
 *
 * What has NOT changed: it is still a server component, it still holds no
 * selection state, and the filter, the scope and the page are all still in the
 * query (PERF-02).
 * ========================================================================== */

export interface Column<T> {
  readonly id: string;
  readonly header: string;
  readonly align?: "start" | "end";
  readonly numeric?: boolean;
  /**
   * The `?sort=` key this column orders by. Set ONLY where the endpoint reads
   * it — an unbacked key silently sorts by something else.
   */
  readonly sortKey?: string;
  /** Keep on one line: references, dates, tracking numbers. */
  readonly nowrap?: boolean;
  /** A minimum for this column, so a dense cell does not collapse. */
  readonly width?: string;
  /** Applied to BOTH the header and the body cells — the one legitimate use
   *  today is `hidden md:table-cell`, a mobile representation that keeps the
   *  decisive columns on screen instead of a third of a 1,000px table. The
   *  cells stay in the DOM, so contract assertions and copy-paste still see
   *  them. */
  readonly className?: string;
  readonly cell: (row: T) => ReactNode;
}

export interface SortState {
  /** Where the header links point. */
  readonly basePath: string;
  /** Every other filter, preserved — losing them on a sort is the classic bug. */
  readonly params: URLSearchParams;
  readonly active: string | null;
  readonly dir: "asc" | "desc";
  readonly s: {
    /** "Sort by {column}" */
    readonly sortBy: string;
    readonly ascending: string;
    readonly descending: string;
  };
}

export interface EmptyCopy {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

function sortHref(sort: SortState, key: string): string {
  const next = new URLSearchParams(sort.params);
  // Clicking the ACTIVE column flips direction; clicking a new one starts
  // descending, because every column here is "most recent / largest / latest
  // first" on first look.
  const dir = sort.active === key && sort.dir === "desc" ? "asc" : "desc";
  next.set("sort", key);
  next.set("dir", dir);
  // Sorting reshuffles the whole list, so page 3 of the old order is a
  // meaningless place to land. Same reasoning as the filter bar's reset.
  next.delete("page");
  const query = next.toString();
  return query ? `${sort.basePath}?${query}` : sort.basePath;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowAttrs,
  empty,
  emptyCopy,
  testId,
  sort,
  caption,
  /** A header-cell node for the selection column — "select all" lives here. */
  selectAll,
  rowDetail,
  expandLabel,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  rowAttrs?: (row: T) => Record<string, string>;
  /** The one-line fallback. Kept for every caller that has not moved to
   *  `emptyCopy`, and for the case where there genuinely is one sentence. */
  empty: string;
  emptyCopy?: EmptyCopy;
  testId?: string;
  sort?: SortState;
  caption?: string;
  selectAll?: ReactNode;
  /**
   * A second, full-width row this one opens out into — PM.3.
   *
   * The ERP asks for it in one place and it is the place the whole catalogue is
   * managed from: a product row carries a variant COUNT and a rolled-up stock
   * figure, and the question an operator actually has is which of the twelve
   * variants is gone. A 200-unit shoe is not fine if 199 of them are size 45,
   * and the roll-up says 200 either way.
   *
   * IT IS A CHECKBOX AND A CSS RULE, NOT STATE. `.console-table` in
   * `globals.css` hides `tr[data-row-detail]` and reveals it with
   * `tr:has(input[data-row-expand]:checked) + tr[data-row-detail]`. So this
   * table stays a server component, a catalogue of 200 products ships no
   * JavaScript to open one of them, the contents are in the HTML for a contract
   * test to assert (D-06.4's principle applied to a read surface), and the
   * disclosure survives the density toggle and a `router.refresh()`.
   *
   * Return `null` for a row with nothing to open — the toggle is then not
   * rendered, rather than rendered and doing nothing.
   */
  rowDetail?: (row: T) => ReactNode;
  /** Accessible name for the disclosure control. Required with `rowDetail`. */
  expandLabel?: string;
}) {
  if (rows.length === 0) {
    // Carries the same testId as the populated table, and says it is empty
    // rather than missing. A screen with no rows and a screen that failed to
    // render look identical to a test otherwise.
    return (
      <EmptyState
        testId={testId}
        title={emptyCopy?.title ?? empty}
        description={emptyCopy?.description}
        action={emptyCopy?.action}
      />
    );
  }

  return (
    <div
      className={cn(
        "scroll-shadow-x overflow-auto rounded-lg border border-border bg-surface-raised",
        // The cap only exists where there is room for it. Below `md` the table
        // scrolls with the page: a nested vertical scroll region on a phone is
        // a trap, and the sticky header it would buy is worth less than the
        // trap costs.
        //
        // The underscores are load-bearing. Tailwind reads a space in an
        // arbitrary value as the end of the class, so it has to be written as
        // `_`; without them this emits `calc(100dvh-var(…)-13rem)`, which CSS
        // rejects because `calc` needs whitespace around `-`. The declaration is
        // then dropped, the container has no height, `position: sticky` has
        // nothing to stick to, and the header scrolls away exactly as before —
        // silently, and with the class sitting right there in the markup.
        // Found by looking at the running page, not by reading it.
        "md:max-h-[calc(100dvh_-_var(--console-header-h)_-_13rem)]",
      )}
    >
      {/* The minimum is `md+` only: it exists so a narrow DESKTOP window keeps
          readable columns, but on a phone it FORCED 640px and pushed the
          decisive columns off-screen. Below `md` a table takes its content's
          own width — table layout never squashes below content minimum, so
          dense tables still scroll in their container exactly as before. */}
      <table className="console-table w-full md:min-w-[640px] text-sm" data-testid={testId}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10 bg-surface-subtle text-xs text-muted-foreground">
          <tr className="border-b border-border">
            {rowDetail && <th scope="col" className="w-8 px-1 py-2.5" />}
            {columns.map((c) => {
              const sortable = Boolean(sort && c.sortKey);
              const active = sortable && sort!.active === c.sortKey;
              const ariaSort = active
                ? sort!.dir === "asc"
                  ? ("ascending" as const)
                  : ("descending" as const)
                : sortable
                  ? ("none" as const)
                  : undefined;

              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={ariaSort}
                  style={c.width ? { minWidth: c.width } : undefined}
                  className={cn(
                    "px-3 py-2.5 font-medium whitespace-nowrap",
                    c.align === "end" ? "text-end" : "text-start",
                    c.numeric && "tabular-nums",
                    c.className,
                  )}
                >
                  {sortable ? (
                    <Link
                      href={sortHref(sort!, c.sortKey!)}
                      data-sort={c.sortKey}
                      data-sort-active={active ? sort!.dir : undefined}
                      // The direction is stated in words for anybody who cannot
                      // see which way the arrow points. `aria-sort` above says
                      // the CURRENT state; this says what the link DOES.
                      aria-label={`${sort!.s.sortBy.replace("{column}", c.header)} — ${
                        active && sort!.dir === "desc" ? sort!.s.ascending : sort!.s.descending
                      }`}
                      className={cn(
                        "group inline-flex items-center gap-1 rounded-sm",
                        "transition-colors duration-(--duration-fast) hover:text-foreground",
                        active && "text-foreground",
                        c.align === "end" && "flex-row-reverse",
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === "asc" ? (
                          <ArrowUp aria-hidden="true" className="size-3" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown
                          aria-hidden="true"
                          className="size-3 opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-60"
                        />
                      )}
                    </Link>
                  ) : c.id === "select" && selectAll ? (
                    selectAll
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const detail = rowDetail?.(row) ?? null;
            return (
              // The selected state comes from the DOM's own checkbox rather
              // than from React state, so there is no second copy of what is
              // ticked to drift from what is on screen — the property the
              // plain-checkbox selection was chosen for in the first place. The
              // rule lives in `globals.css` because it now has to exclude the
              // EXPANDER checkbox, and a Tailwind arbitrary variant carrying
              // `:not(...)` is exactly the shape this project has a rule about.
              <Fragment key={key}>
                <tr
                  {...(rowAttrs?.(row) ?? {})}
                  className="border-t border-border transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                >
                  {rowDetail && (
                    <td className="w-8 px-1 align-top">
                      {detail && (
                        <label
                          className="tap inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground"
                          title={expandLabel}
                        >
                          <input
                            type="checkbox"
                            data-row-expand={key}
                            aria-label={expandLabel}
                            className="peer sr-only"
                          />
                          <ChevronRight
                            aria-hidden="true"
                            className="size-4 transition-transform duration-(--duration-fast) peer-checked:rotate-90 rtl:-scale-x-100"
                          />
                        </label>
                      )}
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "px-3 align-top",
                        c.align === "end" && "text-end",
                        c.numeric && "tabular-nums",
                        c.nowrap && "whitespace-nowrap",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
                {detail && (
                  <tr data-row-detail={key} className="border-t border-border bg-surface-subtle">
                    <td colSpan={columns.length + 1} className="px-4 py-3">
                      {detail}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A status pill. Colour comes from the shared tone tokens, never a literal. */
export function StatusPill({
  status,
  label,
  vars,
}: {
  status: string;
  label: string;
  vars: Record<string, string>;
}) {
  return (
    <span
      data-status={status}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={vars}
    >
      {label}
    </span>
  );
}
