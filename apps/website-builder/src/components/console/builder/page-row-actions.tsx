"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { button } from "@/components/console/ui/styles";

/* =============================================================================
 * Row actions for the pages list (LB.6).
 *
 * Before this, the list had NO row action at all — not even a link into the
 * editor. The only door to editing an existing page was re-running the create
 * flow's redirect. Edit is a plain link; Duplicate calls the API route
 * (D-06.1) and lands the operator in the copy's editor; View opens the public
 * page for a published row.
 * ========================================================================== */

export function PageRowActions({
  id,
  publicPath,
  published,
  archived,
  orderCount,
  labels,
  errors,
}: {
  readonly id: string;
  readonly publicPath: string;
  readonly published: boolean;
  /** An archived row offers Restore in place of Archive — the same door both
   *  ways, so a merchant never has to find a different screen to undo. */
  readonly archived: boolean;
  /** How many orders this page has sold. Decides whether Delete is offered at
   *  all — see the comment on `remove` below. The list already selects it for
   *  the Orders column, so this costs no extra query. */
  readonly orderCount: number;
  readonly labels: {
    edit: string;
    duplicate: string;
    view: string;
    archive: string;
    restore: string;
    archiveConfirm: string;
    delete: string;
    deleteConfirm: string;
  };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();

  const duplicate = async () => {
    const { ok, data } = await run("POST", `/api/builder/landings/${id}/duplicate`);
    if (ok && data && typeof data === "object" && "id" in data) {
      // Straight into the copy's editor — duplicating is the START of editing,
      // not an end in itself.
      router.push(`/console/builder/pages/${(data as { id: string }).id}/edit`);
    }
  };

  /* ARCHIVE, not delete — and the label says archive because that is what it
     does. A landing page cascades to its SalesOrders, so "delete" here would
     take a product's whole commercial history with it (LB.33). Archiving
     unpublishes and hides; the orders stay. Only archiving asks, because only
     archiving changes what customers can see. */
  const setArchived = async (next: boolean) => {
    if (next && !window.confirm(labels.archiveConfirm)) return;
    const { ok } = await run("POST", `/api/builder/landings/${id}/archive`, { archived: next });
    if (ok) router.refresh();
  };

  /* DELETE, and it is a genuinely different act from Archive — LB.38.
   *
   * The hardened route has existed since LB.34: it refuses `409 HAS_ORDERS`
   * for a page that has sold anything and hard-deletes one that has not. What
   * it never had was a door. Its own comment said archiving "is what the
   * console now offers", and that was the whole story — a mistyped draft could
   * only ever be archived, so an archive nobody wanted filled up with pages
   * that had never been anything.
   *
   * OFFERED ONLY AT ZERO ORDERS, which is belt and braces on purpose. The
   * route is the authority and refuses regardless; the button's absence is so
   * a merchant is never invited to press something that always fails for them.
   * Hiding it also puts Archive where their eye already is for exactly the
   * pages where Archive is the right answer.
   *
   * No `router.refresh()` on success and no optimistic removal: `run` already
   * settles, and the row is gone, so refresh is what re-renders the list
   * without it. Kept explicit rather than relying on the archive path's. */
  const remove = async () => {
    if (!window.confirm(labels.deleteConfirm)) return;
    const { ok } = await run("DELETE", `/api/builder/landings/${id}`);
    if (ok) router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="page-row-actions">
      <Link href={`/console/builder/pages/${id}/edit`} className={button("default", "sm")}>
        {labels.edit}
      </Link>
      <ActionButton pending={pending} pendingLabel="…" size="sm" variant="default" onClick={duplicate}>
        {labels.duplicate}
      </ActionButton>
      {published && (
        <a href={publicPath} target="_blank" rel="noreferrer" className={button("ghost", "sm")}>
          {labels.view}
        </a>
      )}
      <ActionButton
        pending={pending}
        pendingLabel="…"
        size="sm"
        variant="ghost"
        data-testid={archived ? "page-restore" : "page-archive"}
        onClick={() => setArchived(!archived)}
      >
        {archived ? labels.restore : labels.archive}
      </ActionButton>
      {/* Only for a page that has never sold anything. A page WITH orders sees
          Archive above and no Delete at all, which is the honest offer: the
          route would refuse it, and a button that always refuses is worse than
          no button. */}
      {orderCount === 0 && (
        <ActionButton
          pending={pending}
          pendingLabel="…"
          size="sm"
          variant="ghost"
          data-testid="page-delete"
          onClick={remove}
        >
          {labels.delete}
        </ActionButton>
      )}
      <ActionError message={error} />
    </div>
  );
}
