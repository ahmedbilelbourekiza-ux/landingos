import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { DensityToggle } from "../density-toggle";

/* =============================================================================
 * The frame every list screen shares — UI.15.
 *
 * WHAT IT FIXES. Six components on the order screen each applied their own top
 * margin from inside their own file — `mt-4` in the create panel, `mt-4` in the
 * import panel, `mt-4` in the filter bar, `mt-4` in the export panel, `mt-6` in
 * the table, `mt-4` in the pager — so the space between two panels was decided
 * by whichever of them happened to render second, and reordering two of them
 * changed the layout. The rhythm belongs to the container (rule 4 in
 * `styles.ts`), and this is the container.
 *
 * It also gives a list the two rows it always wanted and nowhere to put:
 * a TOOLBAR above the table (what is being looked at, and how) and a FOOTER
 * below it (where in the results you are). The density control lives in the
 * footer rather than the toolbar deliberately — it is a viewing preference, not
 * a query, and putting it beside the filters would suggest it changes what the
 * list contains.
 *
 * A server component. The only client thing inside it is the density toggle,
 * which owns nothing but a `data-` attribute on `<html>`.
 * ========================================================================== */

export function ListFrame({
  toolbar,
  children,
  pager,
  density,
  className,
}: {
  /** Filters, exports, bulk controls — anything that changes what is shown. */
  readonly toolbar?: ReactNode;
  /** The table. */
  readonly children: ReactNode;
  /** The `<Pager>`. */
  readonly pager?: ReactNode;
  /** Omit on a list too short for density to matter (a dashboard panel). */
  readonly density?: {
    readonly density: string;
    readonly comfortable: string;
    readonly compact: string;
  };
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {toolbar}
      {children}
      {(pager || density) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{pager}</div>
          {density && <DensityToggle labels={density} />}
        </div>
      )}
    </div>
  );
}
