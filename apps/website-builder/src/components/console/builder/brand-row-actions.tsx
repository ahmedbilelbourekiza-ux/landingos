"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* LB.36 — row actions for the brands list: the categories rows' shape
 * (visibility toggle, armed inline delete — pages survive by SetNull, the
 * hint states it) plus a collapsible category-link editor, because a brand's
 * categories change after creation and deleting the brand to relink would
 * un-brand every page pointing at it. */

export function BrandRowActions({
  id,
  isVisible,
  categoryIds,
  categories,
  labels,
  errors,
}: {
  readonly id: string;
  readonly isVisible: boolean;
  readonly categoryIds: readonly string[];
  readonly categories: ReadonlyArray<{ id: string; name: string }>;
  readonly labels: {
    show: string; hide: string; delete: string; confirmDelete: string;
    editCategories: string; save: string;
  };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();
  const [armed, setArmed] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([...categoryIds]);

  const toggle = async () => {
    const { ok } = await run("PATCH", `/api/builder/brands/${id}`, { isVisible: !isVisible });
    if (ok) router.refresh();
  };

  const remove = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    const { ok } = await run("DELETE", `/api/builder/brands/${id}`);
    if (ok) router.refresh();
  };

  const saveCategories = async () => {
    const { ok } = await run("PATCH", `/api/builder/brands/${id}`, { categoryIds: selected });
    if (ok) {
      setEditing(false);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col items-end gap-2" data-testid="brand-row-actions">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton pending={pending} pendingLabel="…" size="sm" variant="default" onClick={toggle}>
          {isVisible ? labels.hide : labels.show}
        </ActionButton>
        {categories.length > 0 && (
          <ActionButton
            pending={false}
            pendingLabel="…"
            size="sm"
            variant="ghost"
            onClick={() => setEditing((v) => !v)}
          >
            {labels.editCategories}
          </ActionButton>
        )}
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
      </div>
      {editing && (
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm" data-testid="brand-category-editor">
          {categories.map((c) => (
            <label key={c.id} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() =>
                  setSelected((prev) =>
                    prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                  )
                }
              />
              {c.name}
            </label>
          ))}
          <ActionButton pending={pending} pendingLabel="…" size="sm" variant="default" onClick={saveCategories}>
            {labels.save}
          </ActionButton>
        </div>
      )}
      <ActionError message={error} />
    </div>
  );
}
