"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { slugify } from "@/lib/landing/create";
import { readTypedMoney, MONEY_PATTERN } from "@/lib/landing/money-field";

/* =============================================================================
 * The create-page form (LB.10's second half).
 *
 * Replaces the page's server action, which was a second write path beside
 * POST /api/builder/landings: it duplicated the validation and the slug-clash
 * check, and it fired no `product.created` webhook — so a page created through
 * the console was invisible to every subscribed CRM while the same creation
 * through the API told them (the exact gap LB.3 closed for order events).
 *
 * Field-level refusals (missing title, bad slug, taken slug) are shown from
 * the `messages` map the server page translates; transport/permission refusals
 * fall through to the shared ActionError. On success the operator lands in the
 * new page's editor, exactly as before.
 * ========================================================================== */

export function NewLandingForm({
  labels,
  messages,
  errors,
}: {
  readonly labels: {
    title: string;
    slug: string;
    slugHint: string;
    price: string;
    submit: string;
  };
  readonly messages: { title: string; price: string; slug: string; taken: string };
  readonly errors: ActionErrors;
}) {
  const router = useRouter();
  const { run, pending, error } = useApiAction(errors);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldError(null);

    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const rawSlug = String(form.get("slug") ?? "").trim();
    /* LB.15's ONE reader, not a second opinion. This form used to do
       `Number(raw.replace(",", "."))`, which turns the French/Algerian «2,500»
       — two thousand five hundred — into 2.5, and creates the page at 2.50 DA
       without a word. `readTypedMoney` REFUSES a comma before three digits
       rather than guessing, because it is a 1000x error either way, and this
       is the screen where a price is set for the first time. */
    const price = readTypedMoney(form.get("price"));

    if (!title) return setFieldError(messages.title);
    if (price === null || price === undefined || price < 0) return setFieldError(messages.price);
    const slug = slugify(rawSlug || title);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return setFieldError(messages.slug);

    const { ok, data } = await run("POST", "/api/builder/landings", { title, slug, price });
    if (ok && data && typeof data === "object" && "id" in data) {
      // Straight into the editor — creating a page is the start of editing it.
      router.push(`/console/builder/pages/${(data as { id: string }).id}/edit`);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      data-testid="new-landing-form"
      className="mt-6 max-w-lg space-y-4 rounded-lg border border-border bg-card p-4"
    >
      {fieldError ? (
        <p
          role="alert"
          data-testid="error"
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--danger-fg)",
            backgroundColor: "var(--danger-bg)",
            borderColor: "var(--danger-border)",
          }}
        >
          {fieldError}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="title" className="ui-label">{labels.title}</label>
        <input id="title" name="title" required maxLength={200} className="ui-control tap w-full" />
      </div>

      <div className="space-y-1">
        <label htmlFor="slug" className="ui-label">{labels.slug}</label>
        <input
          id="slug" name="slug" maxLength={120} placeholder="derived from the title"
          className="ui-control tap w-full"
        />
        <p className="text-xs text-muted-foreground">{labels.slugHint}</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="price" className="ui-label">{labels.price}</label>
        {/* Text with a decimal keypad, never type="number": the column is a
            Decimal and a number input hands back a JS float (M-06 / D-06). */}
        <input
          id="price" name="price" type="text" inputMode="decimal"
          pattern={MONEY_PATTERN} required defaultValue="0"
          className="ui-control tap w-full tabular-nums"
        />
      </div>

      <ActionButton pending={pending} pendingLabel="…" type="submit" variant="primary">
        {labels.submit}
      </ActionButton>
      <ActionError message={error} />
    </form>
  );
}
