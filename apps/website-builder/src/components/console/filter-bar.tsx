import Link from "next/link";

import type { FilterField } from "./filter-field";
import { hasActiveFilter } from "./filter-field";

/* =============================================================================
 * Narrowing a list.
 *
 * WHY THIS EXISTS. `orderFilters` accepts NINE filters — status, agent,
 * follow-up agent, wilaya, channel, order type, classification, delivery
 * outcome and a date range — which is richer than the four the legacy CRM had.
 * None of them was reachable from the orders screen: they existed only as
 * query-string keys, so the answer to "show me pending orders in Alger from
 * yesterday" was to hand-write a URL. A capability nobody can find is not a
 * capability.
 *
 * A PLAIN GET FORM, and a server component. Three consequences, all wanted:
 * the filters live in the URL so a manager can bookmark "my overdue queue" and
 * send it to somebody; the screen and the API read the SAME query string
 * through the SAME function, so they cannot interpret it differently; and it
 * works before JavaScript, which is what lets a contract test assert the
 * offered vocabulary rather than guess at it.
 *
 * THE FIELDS ARE NOT DEFINED HERE. They are handed in, built from the module
 * the route validates against — see `filter-field.ts` for why that is the whole
 * point of the file.
 * ========================================================================== */

const CONTROL = "ui-control tap";

export interface FilterStrings {
  readonly apply: string;
  readonly clear: string;
  readonly any: string;
}

export function FilterBar({
  basePath,
  params,
  fields,
  s,
  testId = "filters",
}: {
  readonly basePath: string;
  readonly params: URLSearchParams;
  readonly fields: readonly FilterField[];
  readonly s: FilterStrings;
  readonly testId?: string;
}) {
  if (!fields.length) return null;
  const active = hasActiveFilter(params, fields);

  return (
    <form
      method="get"
      action={basePath}
      data-testid={testId}
      // A surface rather than an outline on the page ground, and the fields
      // wrap into a grid at every width instead of a single row that overflows
      // — nine order filters on a laptop used to push Apply off the end.
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-raised p-3"
    >
      {fields.map((field) => {
        const id = `filter-${field.name}`;
        const value = params.get(field.name) ?? "";
        return (
          <div key={field.name} className={field.wide ? "min-w-56 flex-1" : ""}>
            <label htmlFor={id} className="ui-label block">
              {field.label}
            </label>

            {field.kind === "select" ? (
              <select
                id={id}
                name={field.name}
                defaultValue={value}
                className={`mt-1 w-full ${CONTROL}`}
              >
                <option value="">{field.anyLabel ?? s.any}</option>
                {(field.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={field.name}
                type={field.kind === "date" ? "date" : "search"}
                defaultValue={value}
                // A date is always left-to-right, even on an RTL page.
                {...(field.kind === "date" ? { dir: "ltr" as const } : {})}
                className={`mt-1 w-full ${CONTROL}`}
              />
            )}
          </div>
        );
      })}

      {/* Paging is reset on every apply, and it has to be: filtering to four
          results while sitting on page 3 shows an empty table, which reads as
          "no matches" and is a lie. A hidden empty `page` overwrites whatever
          was in the URL. */}
      <input type="hidden" name="page" value="" />

      <button
        type="submit"
        data-testid={`${testId}-apply`}
        className="ui-btn ui-btn-primary tap"
      >
        {s.apply}
      </button>

      {/* Offered only when something is actually filtered — a permanently
          visible "clear" on an unfiltered list is a control that does nothing. */}
      {active && (
        <Link
          href={basePath}
          data-testid={`${testId}-clear`}
          className="ui-btn ui-btn-default tap"
        >
          {s.clear}
        </Link>
      )}
    </form>
  );
}
