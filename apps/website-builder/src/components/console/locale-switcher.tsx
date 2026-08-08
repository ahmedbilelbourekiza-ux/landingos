"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { Check } from "lucide-react";

import { LOCALES, LOCALE_NAMES } from "@landingos/i18n";
import { switchLocaleAction } from "@/app/console/actions";
import { iconButton, select as selectClass } from "./ui/styles";
import { cn } from "@/lib/utils";

/**
 * Each language is named in itself, so it reads to the person choosing it.
 *
 * The submit control was the character `↵`, which is not a word in any of the
 * three languages this product ships in and is announced by a screen reader as
 * "return symbol". It is a labelled icon button now — and the label is
 * "Apply", because a button that says "Language" next to a language select
 * reads as a heading rather than as an action.
 *
 * Still a plain form. It works before hydration, which is the property that
 * lets somebody whose JavaScript failed switch away from a language they
 * cannot read.
 *
 * AND IT SUBMITS ITSELF ON CHANGE. Choosing a language from the dropdown did
 * nothing until the ✓ icon beside it was ALSO clicked — a second step no
 * language menu anywhere has taught people to expect, so "switching to
 * Arabic" silently switched nothing (observed as a real user report, not a
 * hypothetical). `requestSubmit()` drives the same form action the button
 * does; the button stays for the pre-hydration path, where the onChange does
 * not exist yet and the two-step flow still works.
 */
export function LocaleSwitcher({ label, apply }: { label: string; apply: string }) {
  const current = useLocale();
  const pathname = usePathname();

  return (
    <form action={switchLocaleAction} className="flex items-center gap-1">
      <label htmlFor="locale" className="sr-only">
        {label}
      </label>
      <input type="hidden" name="returnTo" value={pathname} />
      <select
        id="locale"
        name="locale"
        defaultValue={current}
        data-testid="locale-switcher"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={cn(selectClass, "h-9 w-auto py-1.5")}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
      <button type="submit" aria-label={apply} title={apply} className={iconButton("ghost", "sm")}>
        <Check aria-hidden="true" className="size-4" />
      </button>
    </form>
  );
}
