import type { ReactNode } from "react";

/**
 * The console's table.
 *
 * Extracted the moment a second screen needed one, not before. Every product's
 * list screen renders through this, which is most of what makes the ERP's
 * tables look like the builder's when Phase 6 arrives.
 *
 * Wide content scrolls inside its own container so the page body never scrolls
 * sideways, and numeric columns are tabular so digits line up down the column.
 */
export interface Column<T> {
  readonly id: string;
  readonly header: string;
  readonly align?: "start" | "end";
  readonly numeric?: boolean;
  readonly cell: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowAttrs,
  empty,
  testId,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  rowAttrs?: (row: T) => Record<string, string>;
  empty: string;
  testId?: string;
}) {
  if (rows.length === 0) {
    // Carries the same testId as the populated table, and says it is empty
    // rather than missing. A screen with no rows and a screen that failed to
    // render look identical to a test otherwise.
    return (
      <p
        data-testid={testId}
        data-empty="true"
        className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
      >
        {empty}
      </p>
    );
  }

  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-sm" data-testid={testId}>
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                className={`px-4 py-3 font-medium ${c.align === "end" ? "text-end" : "text-start"} ${
                  c.numeric ? "tabular-nums" : ""
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} {...(rowAttrs?.(row) ?? {})} className="border-t border-border">
              {columns.map((c) => (
                <td
                  key={c.id}
                  className={`px-4 py-3 ${c.align === "end" ? "text-end" : ""} ${
                    c.numeric ? "tabular-nums" : ""
                  }`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
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
      className="inline-block rounded-full border px-2 py-0.5 text-xs"
      style={vars}
    >
      {label}
    </span>
  );
}
