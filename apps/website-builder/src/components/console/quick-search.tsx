"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

/* =============================================================================
 * The header's quick lookup — PM.7.
 *
 * WHAT IT REMOVES. "A customer is on the phone and gives me a number" is the
 * single most frequent question anybody asks this software, and answering it
 * cost four navigations: open the product, open the order list, open the filter
 * bar, type, submit. `orderFilters` has read `search` since LP.3 and it reaches
 * the reference, the customer name and the phone number — the capability was
 * always there and the distance to it was the whole cost.
 *
 * IT IS A PLAIN GET FORM, deliberately, and it is the same decision the filter
 * bar and the pager were built on. No fetch, no debounce, no dropdown of
 * guesses: it submits to the screen that already knows how to render results,
 * so the answer is a URL somebody can bookmark, share with a colleague, or open
 * in a second tab — and it works before JavaScript.
 *
 * IT KNOWS NO PRODUCT. Everything specific — where it submits, which parameter
 * it sets, what the placeholder says — arrives as props from the manifest's
 * `search` declaration, resolved in the shell. A header that hard-coded
 * `/console/erp/orders?search=` would be the shell knowing what an ERP is,
 * which is the one thing the registry exists to prevent.
 *
 * THE ONLY CLIENT BEHAVIOUR IS THE SHORTCUT, and it is why this carries a
 * directive at all: `/` focuses the box from anywhere in the console, the way
 * every tool people already use does it. Guarded so it does not steal the
 * keystroke from somebody typing a slash into a note.
 * ========================================================================== */

export function QuickSearch({
  action,
  param,
  placeholder,
  label,
  shortcutHint,
}: {
  readonly action: string;
  readonly param: string;
  readonly placeholder: string;
  readonly label: string;
  /** Rendered inside the box on a pointer device, as the kbd hint. */
  readonly shortcutHint: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      // Never steal the keystroke from somebody typing. `isContentEditable`
      // covers the builder's rich-text editors, which are neither an input nor
      // a textarea.
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      action={action}
      method="get"
      role="search"
      data-testid="console-quick-search"
      className="relative hidden min-w-0 flex-1 md:block md:max-w-xs"
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-muted-foreground"
      />
      <input
        ref={input}
        type="search"
        name={param}
        aria-label={label}
        placeholder={placeholder}
        // `ps-8` for the icon, `pe-8` for the hint. Logical properties, so the
        // icon lands on the correct side of an Arabic page without a second
        // rule.
        className="ui-control h-9 w-full ps-8 pe-9"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-2 my-auto hidden h-5 items-center rounded border border-border bg-surface-subtle px-1.5 font-mono text-2xs text-muted-foreground lg:flex"
      >
        {shortcutHint}
      </kbd>
    </form>
  );
}
