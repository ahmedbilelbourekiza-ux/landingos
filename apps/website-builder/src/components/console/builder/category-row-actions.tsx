"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* Row actions for the categories list — B3's write half. Visibility is a
 * one-click toggle; delete asks once, inline, instead of raising a dialog for
 * an action whose blast radius the hint already states (pages survive, the
 * FK is SetNull). */

export function CategoryRowActions({
  id,
  isVisible,
  labels,
  errors,
}: {
  readonly id: string;
  readonly isVisible: boolean;
  readonly labels: { show: string; hide: string; delete: string; confirmDelete: string };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();
  const [armed, setArmed] = React.useState(false);

  const toggle = async () => {
    const { ok } = await run("PATCH", `/api/builder/categories/${id}`, { isVisible: !isVisible });
    if (ok) router.refresh();
  };

  const remove = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    const { ok } = await run("DELETE", `/api/builder/categories/${id}`);
    if (ok) router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="category-row-actions">
      <ActionButton pending={pending} pendingLabel="…" size="sm" variant="default" onClick={toggle}>
        {isVisible ? labels.hide : labels.show}
      </ActionButton>
      <ActionButton
        pending={pending}
        pendingLabel="…"
        size="sm"
        variant={armed ? "danger" : "ghost"}
        onClick={remove}
        onBlur={() => setArmed(false)}
      >
        {armed ? labels.confirmDelete : labels.delete}
      </ActionButton>
      <ActionError message={error} />
    </div>
  );
}
