"use client";

import * as React from "react";
import { Sparkles, Loader2, Plus, Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useBuilderApi } from "@/lib/builder/api-base";

/* =============================================================================
 * CAT.1 — the category field: type freely, or pick what exists, or ask.
 *
 * WHAT IT REPLACES, and why the old control was the problem. A `<select>` can
 * only offer what a merchant has already created, so using it meant leaving
 * the editor, going to the Categories screen, creating a category, coming
 * back, and finding it in the list. That round trip is the chore the merchant
 * asked to be rid of — not the concept of categories, which is load-bearing
 * (the storefront's category listings, the store home's nav, and every
 * category URL in `sitemap.xml` are all built from it).
 *
 * BOTH PATHS, NEVER EITHER/OR, which is what was asked for. Typing filters the
 * existing categories AND offers to create what was typed; the suggestion
 * button fills the same box. There is one input, and everything else is a way
 * of putting a value into it.
 *
 * NOTHING HAPPENS WITHOUT THE MERCHANT. The AI suggests into the box and never
 * assigns; creating a category is an explicit press, and it goes through
 * `POST /api/builder/categories` — the route that already owns the slug rules,
 * the digit-only guard and the duplicate 409 — rather than a second creation
 * path free to disagree with it.
 * ========================================================================== */

interface Category {
  id: string;
  name: string;
}

const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export function CategoryField({
  categories,
  value,
  onChange,
  onCategoryCreated,
  productName,
  description,
}: {
  readonly categories: readonly Category[];
  /** The chosen category id, or null for uncategorised. */
  readonly value: string | null;
  readonly onChange: (categoryId: string | null) => void;
  readonly onCategoryCreated: (created: Category) => void;
  /** What the suggestion is made from — the page's own words. */
  readonly productName: string;
  readonly description: string;
}) {
  const t = useTranslations();
  const api = useBuilderApi();

  const chosen = categories.find((c) => c.id === value) ?? null;
  const [query, setQuery] = React.useState(chosen?.name ?? "");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<"idle" | "suggesting" | "creating">("idle");
  const [suggestions, setSuggestions] = React.useState<
    { name: string; reason: string | null; existingId: string | null }[]
  >([]);
  const [note, setNote] = React.useState<string | null>(null);

  // The box follows the stored value when it changes underneath (a restore, a
  // discard) without fighting the merchant while they are typing in it.
  React.useEffect(() => {
    setQuery(chosen?.name ?? "");
  }, [chosen?.name]);

  const typed = query.trim();
  const matches = typed
    ? categories.filter((c) => c.name.toLowerCase().includes(typed.toLowerCase()))
    : categories;
  const exact = categories.find((c) => c.name.toLowerCase() === typed.toLowerCase()) ?? null;

  const pick = (category: Category) => {
    onChange(category.id);
    setQuery(category.name);
    setSuggestions([]);
    setNote(null);
    setOpen(false);
  };

  const createTyped = async (name: string) => {
    setBusy("creating");
    setNote(null);
    try {
      const res = await fetch(api("/categories"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug: slugify(name) }),
      });
      const json = await res.json();
      if (!json.success) {
        // The most likely refusal by far is a slug already taken — which
        // means the merchant already HAS this category under another name.
        setNote(t("builder.editor.categoryCreateFailed"));
        setBusy("idle");
        return;
      }
      const created = { id: json.data.id as string, name: json.data.name as string };
      onCategoryCreated(created);
      pick(created);
    } catch {
      setNote(t("builder.editor.categoryCreateFailed"));
    }
    setBusy("idle");
  };

  const suggest = async () => {
    setBusy("suggesting");
    setNote(null);
    setSuggestions([]);
    try {
      const res = await fetch(api("/categories/suggest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName, description }),
      });
      const json = await res.json();
      if (!json.success) {
        /* Every refusal this route can produce says something different and
           the merchant can act on two of them, so they are not collapsed into
           "that didn't work": AI switched off platform-wide, the shop's
           monthly allowance used up, or this person not being allowed to
           spend it. */
        const code = json.error?.code as string | undefined;
        setNote(
          code === "NO_AI_PROVIDER"
            ? t("builder.editor.categoryAiOff")
            : code === "AI_QUOTA_EXCEEDED"
              ? t("builder.editor.categoryAiQuota")
              : code === "AI_SPEND_FORBIDDEN"
                ? t("builder.editor.categoryAiForbidden")
                : t("builder.editor.categoryAiFailed"),
        );
        setBusy("idle");
        return;
      }
      const items = json.data.suggestions ?? [];
      setSuggestions(items);
      if (!items.length) setNote(t("builder.editor.categoryAiNone"));
      setOpen(true);
    } catch {
      setNote(t("builder.editor.categoryAiFailed"));
    }
    setBusy("idle");
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          id="categoryId"
          value={query}
          placeholder={t("builder.editor.categoryPlaceholder")}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Clearing the box means uncategorised, immediately — otherwise a
            // merchant emptying it would silently keep the old category.
            if (!e.target.value.trim()) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          // Blur is delayed so a click on an option below still registers.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        />
        <Button
          type="button"
          variant="outline"
          data-testid="category-suggest"
          disabled={busy !== "idle" || !productName.trim()}
          onClick={() => void suggest()}
          title={t("builder.editor.categorySuggestHint")}
        >
          {busy === "suggesting" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          <span className="ms-1.5">{t("builder.editor.categorySuggest")}</span>
        </Button>
      </div>

      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}

      {open && (matches.length > 0 || suggestions.length > 0 || (typed && !exact)) && (
        <div
          data-testid="category-options"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md"
        >
          {suggestions.length > 0 && (
            <div className="border-b border-border">
              <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
                {t("builder.editor.categorySuggested")}
              </p>
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                  onClick={() => {
                    const existing = s.existingId
                      ? categories.find((c) => c.id === s.existingId)
                      : null;
                    if (existing) pick(existing);
                    // A NEW name is only filled in, never created behind the
                    // merchant's back: a category is a public URL.
                    else {
                      setQuery(s.name);
                      setSuggestions([]);
                    }
                  }}
                >
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    {s.name}
                    {s.existingId && (
                      <span className="ms-1.5 text-xs text-muted-foreground">
                        {t("builder.editor.categoryExisting")}
                      </span>
                    )}
                    {s.reason && (
                      <span className="block text-xs text-muted-foreground">{s.reason}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="max-h-56 overflow-y-auto">
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                data-category-option={c.id}
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                onClick={() => pick(c)}
              >
                {c.id === value ? (
                  <Check className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                {c.name}
              </button>
            ))}
          </div>

          {typed && !exact && (
            <button
              type="button"
              data-testid="category-create"
              disabled={busy === "creating"}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-start text-sm font-medium hover:bg-accent"
              onClick={() => void createTyped(typed)}
            >
              {busy === "creating" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-3.5" aria-hidden />
              )}
              {t("builder.editor.categoryCreate", { name: typed })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
