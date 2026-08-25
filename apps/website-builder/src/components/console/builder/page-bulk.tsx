"use client";

import { useRef, useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * BULK.1 — acting on several landing pages at once.
 *
 * THE SELECTION IS A FORM, not client state mirroring one. `OrderBulkBar`
 * established this and the reasoning holds exactly: the table stays a SERVER
 * component and arrives as `children`, the checkboxes it renders are plain
 * inputs, and this reads them with `FormData`. The list keeps being
 * server-rendered — its filtering, its archived scope and its 50-row window all
 * still happen in the query — and there is no second copy of which rows are
 * ticked to fall out of step with the ones on screen.
 *
 * THE OUTCOME IS A COUNT, NOT A VERDICT. Deleting refuses any page that has
 * ever been ordered from (LB.33), so a mixed selection is the normal case
 * rather than the exotic one: nineteen drafts go and the twentieth is named.
 * A bar that reported "that did not work" would leave the merchant to find the
 * one page by hand, which is the whole job they were trying to avoid.
 * ========================================================================== */

export interface PageBulkStrings {
  readonly saving: string;
  readonly selected: string;
  readonly selectAll: string;
  readonly sendToManager: string;
  readonly archive: string;
  readonly restore: string;
  readonly delete: string;
  readonly deleteConfirm: string;
  readonly outcome: string;
  readonly refusedHasOrders: string;
  readonly nothingSelected: string;
}

type Action = "send" | "archive" | "restore" | "delete";

export function PageBulkBar({
  errors,
  s,
  /** Only offered when the tenant HAS the Manager and may write its catalogue. */
  canSend,
  /** False for a reader: the same table, with no bar and no checkboxes. */
  canWrite,
  archivedView,
  children,
}: {
  readonly errors: ActionErrors;
  readonly s: PageBulkStrings;
  readonly canSend: boolean;
  readonly canWrite: boolean;
  readonly archivedView: boolean;
  readonly children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { run, pending, error } = useApiAction(errors);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  const idsNow = () => {
    const form = formRef.current;
    if (!form) return [];
    return new FormData(form).getAll("pageId").map(String);
  };

  const recount = () => setSelected(idsNow().length);

  const toggleAll = (checked: boolean) => {
    const form = formRef.current;
    if (!form) return;
    for (const box of form.querySelectorAll<HTMLInputElement>('input[name="pageId"]')) {
      box.checked = checked;
    }
    recount();
  };

  const apply = async (action: Action) => {
    const ids = idsNow();
    setNote(null);
    if (!ids.length) {
      setNote(s.nothingSelected);
      return;
    }
    if (action === "delete" && !window.confirm(s.deleteConfirm)) return;

    /* Two endpoints on purpose. Sending goes through `publish-to-erp`, which
       owns the entitlement gate, the adoption rule and the matrix
       reconciliation; the rest go through the bulk route, which owns the
       per-id refusals. Duplicating either into one endpoint would put one rule
       in two places. */
    const { ok, data } = action === "send"
      ? await run("POST", "/api/builder/publish-to-erp", { scope: "many", landingPageIds: ids })
      : await run("POST", "/api/builder/landings/bulk", { action, ids });

    if (!ok) return;

    const d = data as Record<string, unknown> | null;
    if (action === "send") {
      setNote(
        s.outcome
          .replace("{done}", String((d?.created as number ?? 0) + (d?.updated as number ?? 0) + (d?.adopted as number ?? 0)))
          .replace("{total}", String(ids.length)),
      );
    } else {
      const refused = (d?.hasOrders as string[] | undefined) ?? [];
      setNote(
        s.outcome.replace("{done}", String(d?.done ?? 0)).replace("{total}", String(ids.length)) +
          (refused.length ? ` ${s.refusedHasOrders.replace("{count}", String(refused.length))}` : ""),
      );
    }
    // The list is server-rendered, so the truth is one navigation away.
    window.location.reload();
  };

  /* A reader gets the list and nothing else — D-06.2's rule, and rendering it
     here rather than at the call site keeps ONE copy of the table. A ternary
     around the table would have meant two, free to drift apart. */
  if (!canWrite) return <>{children}</>;

  return (
    <form ref={formRef} onChange={recount} data-testid="page-bulk-form">
      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-3"
        data-testid="page-bulk-bar"
      >
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="page-bulk-all"
            onChange={(e) => toggleAll(e.target.checked)}
            className="size-4"
          />
          {s.selectAll}
        </label>

        <span className="text-sm text-muted-foreground" data-testid="page-bulk-count">
          {s.selected.replace("{count}", String(selected))}
        </span>

        <div className="ms-auto flex flex-wrap gap-2">
          {canSend && !archivedView && (
            <ActionButton
              data-testid="bulk-send"
              pending={pending} pendingLabel={s.saving}
              onClick={() => void apply("send")}
            >
              {s.sendToManager}
            </ActionButton>
          )}
          <ActionButton
            data-testid={archivedView ? "bulk-restore" : "bulk-archive"}
            pending={pending} pendingLabel={s.saving}
            onClick={() => void apply(archivedView ? "restore" : "archive")}
          >
            {archivedView ? s.restore : s.archive}
          </ActionButton>
          <ActionButton
            data-testid="bulk-delete"
            pending={pending} pendingLabel={s.saving}
            onClick={() => void apply("delete")}
          >
            {s.delete}
          </ActionButton>
        </div>
      </div>

      {note && <p className="mb-3 text-sm text-muted-foreground" data-testid="page-bulk-note">{note}</p>}
      <ActionError message={error} />

      {children}
    </form>
  );
}
