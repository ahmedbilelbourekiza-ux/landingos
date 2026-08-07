/* =============================================================================
 * The order list's sort vocabulary — UI.12.
 *
 * DIRECTIVE-FREE, AND THAT IS THE WHOLE REASON THE FILE EXISTS. `lib/erp/
 * orders.ts` is `server-only`, so nothing outside a server component can import
 * from it — not a client panel, and not a contract test, which is how the first
 * attempt at asserting this vocabulary died with `ERR_MODULE_NOT_FOUND`. It is
 * the same rule that produced `edit-field.ts`, `filter-field.ts` and
 * `notify-vocab.ts`: anything both sides need lives in a module carrying no
 * directive.
 *
 * ONE LIST, TWO READERS, AND THE COMPILER HOLDS THEM TOGETHER. `orderSort`
 * builds its whitelist as `Record<OrderSortField, …>`, so a key added here
 * without a column FAILS TO COMPILE, and a column added there without a key is
 * unreachable by construction. The screen offers a header only for a key in
 * this list, and `screens.test.ts` asserts both directions.
 *
 * This is D-LP.3's rule — the filter vocabulary lives in the module that
 * validates it — applied to ordering, and it is worth stating why it matters
 * here specifically: `orderSort` falls back to `createdAt` for an unknown
 * column rather than erroring (deliberately, so a stale bookmark renders). A
 * header bound to a key outside this list would therefore render perfectly,
 * sort by date, and claim to have done something else.
 * ========================================================================== */

export const ORDER_SORT_FIELDS = [
  "createdAt",
  "price",
  "client",
  "status",
  "updatedAt",
] as const;

export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

/** Whether a key is one the endpoint would actually honour. */
export const isOrderSortField = (value: string): value is OrderSortField =>
  (ORDER_SORT_FIELDS as readonly string[]).includes(value);
