"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { button } from "@/components/console/ui/styles";
import { slugify, slugCharset } from "@/lib/landing/create";

/* LB.36 — create a brand. The category form's exact shape plus the category
 * checkboxes (a brand sells in MANY categories — the user's decision; the
 * join is set semantics server-side). */

export function BrandCreateForm({
  categories,
  labels,
  errors,
}: {
  readonly categories: ReadonlyArray<{ id: string; name: string }>;
  readonly labels: { create: string; name: string; slug: string; categories: string };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [categoryIds, setCategoryIds] = React.useState<string[]>([]);

  const toggleCategory = (id: string) =>
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    const { ok } = await run("POST", "/api/builder/brands", {
      name: name.trim(),
      slug,
      categoryIds,
    });
    if (ok) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setCategoryIds([]);
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} data-testid="brand-create-form" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {labels.name}
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
            maxLength={120}
            className="ui-control"
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {labels.slug}
          <input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugCharset(e.target.value));
            }}
            required
            maxLength={120}
            dir="ltr"
            className="ui-control font-mono"
          />
        </label>
        <button type="submit" disabled={pending} className={button("primary", "md")}>
          {pending ? "…" : labels.create}
        </button>
      </div>
      {categories.length > 0 && (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="mb-1 text-xs text-muted-foreground">{labels.categories}</legend>
          {categories.map((c) => (
            <label key={c.id} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={categoryIds.includes(c.id)}
                onChange={() => toggleCategory(c.id)}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
      )}
      <ActionError message={error} />
    </form>
  );
}
