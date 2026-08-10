"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { button } from "@/components/console/ui/styles";

/* The create half of B3 (CAPABILITY_AUDIT): POST /api/builder/categories has
 * existed — validated, permission-gated, suite-covered — since the port, and
 * the categories screen offered no way to call it.
 *
 * The slug follows the name automatically until the merchant edits it by
 * hand — the same convention every CMS trains people on — and the API's
 * charset rule is applied while typing rather than quoted back as a 422. */

// The API's charset (lowercase latin, digits, hyphens). An Arabic name
// produces an empty suggestion rather than a mangled one — the merchant
// types the address they want, exactly as the page slug field works.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CategoryCreateForm({
  labels,
  errors,
}: {
  readonly labels: { create: string; name: string; slug: string };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    const { ok } = await run("POST", "/api/builder/categories", { name: name.trim(), slug });
    if (ok) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      router.refresh();
    }
  };

  return (
    <form
      onSubmit={submit}
      data-testid="category-create-form"
      className="flex flex-wrap items-end gap-2"
    >
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
            setSlug(slugify(e.target.value));
          }}
          required
          maxLength={120}
          dir="ltr"
          className="ui-control font-mono"
        />
      </label>
      {/* A real submit button, so Enter in either field submits the form —
          ActionButton is deliberately type="button" and cannot be one. */}
      <button type="submit" disabled={pending} className={button("primary", "md")}>
        {pending ? "…" : labels.create}
      </button>
      <ActionError message={error} />
    </form>
  );
}
