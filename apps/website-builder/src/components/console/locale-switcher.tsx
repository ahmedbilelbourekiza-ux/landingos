"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";

import { LOCALES, LOCALE_NAMES } from "@landingos/i18n";
import { switchLocaleAction } from "@/app/console/actions";

/** Each language is named in itself, so it reads to the person choosing it. */
export function LocaleSwitcher({ label }: { label: string }) {
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
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-md border border-input px-2 py-1 text-sm">
        ↵
      </button>
    </form>
  );
}
