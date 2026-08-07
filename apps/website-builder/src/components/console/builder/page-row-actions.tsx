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
  labels,
  errors,
}: {
  readonly id: string;
  readonly publicPath: string;
  readonly published: boolean;
  readonly labels: { edit: string; duplicate: string; view: string };
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
      <ActionError message={error} />
    </div>
  );
}
