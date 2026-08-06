/* =============================================================================
 * What a LIST FILTER is — the contract between a screen and its filter bar.
 *
 * Directive-free and imported from both sides, exactly like `edit-field.ts`:
 * the server describes the fields from the same module the ROUTE validates
 * against, and the bar renders them. A value exported from a `"use client"`
 * module is a client reference on the server and calling it throws at runtime
 * while the build succeeds — that cost a cycle in 6.3b and there is no reason
 * to pay it twice.
 *
 * THE RULE THIS FILE EXISTS TO HOLD. A filter bar with its own list of fields
 * is a second vocabulary. It goes stale the moment a filter is added to the
 * API, and the way that shows up is not an error — it is a control nobody can
 * find, for a capability that already works. So the descriptors come from
 * `orderFilters`/`clientFilter`'s own module, and the bar renders whatever it
 * is handed. This is D-06.2 applied to reads: offer exactly what the endpoint
 * accepts, no more and no less.
 * ========================================================================== */

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** One control in a filter bar. */
export interface FilterField {
  /** The query-string key. MUST be a key the endpoint's filter function reads. */
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "select" | "date";
  /** The empty choice on a select — "all statuses", "any agent". */
  readonly anyLabel?: string;
  readonly options?: readonly FilterOption[];
  /** Rendered wider, for a search box. */
  readonly wide?: boolean;
}

/**
 * The pieces of a page of results.
 *
 * `total` is what makes this a pager rather than a "load more": an operator
 * asking "how many pending orders are there" is asking a business question, and
 * a next-page arrow with no count cannot answer it. The count costs one extra
 * query against an index that already exists.
 */
export interface PageInfo {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** Whether any filter is actually applied — decides if "clear" is offered. */
export const hasActiveFilter = (
  params: URLSearchParams,
  fields: readonly FilterField[],
): boolean => fields.some((f) => (params.get(f.name) ?? "").trim() !== "");
