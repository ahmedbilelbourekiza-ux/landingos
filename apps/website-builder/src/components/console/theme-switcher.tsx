"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

/* =============================================================================
 * Choosing the theme — UI.11.
 *
 * THE DEFECT. `packages/ui/src/tokens.css` documents at length that the dark
 * palette IS the ERP's own, promoted — "the dense operational screens people
 * use every day keep the exact colour language they already read fluently" —
 * and it was the resolution of risk R-14. `components/shared/theme-toggle.tsx`
 * was written to switch it and **is imported by nothing**. `ThemeProvider` is
 * mounted with `defaultTheme="system"`, so the whole dark theme appeared only
 * if the operating system asked for it and could never be chosen in the
 * product. A call centre that runs its floor lights low had no way to get it.
 *
 * A THREE-WAY SEGMENTED CONTROL, not a two-way toggle. "System" is a real
 * answer and the current default; a toggle that flips light↔dark silently
 * destroys it the first time somebody presses it, and there is then no way back
 * to "follow my machine".
 *
 * `mounted` is not ceremony. `next-themes` cannot know the resolved theme until
 * it has read `localStorage`, so rendering the selected state on the server
 * produces a hydration mismatch on every page in the console. Before mount the
 * control renders in a neutral state that occupies the same box, so nothing
 * moves when it resolves.
 * ========================================================================== */

const OPTIONS = [
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
  { value: "system", Icon: Monitor },
] as const;

export function ThemeSwitcher({
  labels,
}: {
  readonly labels: {
    readonly theme: string;
    readonly light: string;
    readonly dark: string;
    readonly system: string;
  };
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const label = (value: string) =>
    value === "light" ? labels.light : value === "dark" ? labels.dark : labels.system;

  return (
    <div
      role="radiogroup"
      aria-label={labels.theme}
      data-testid="theme-switcher"
      className="flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5"
    >
      {OPTIONS.map(({ value, Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label(value)}
            title={label(value)}
            data-theme-option={value}
            onClick={() => setTheme(value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-[calc(var(--radius)_-_6px)]",
              "transition-colors duration-(--duration-fast) ease-standard",
              selected
                ? "bg-surface-selected text-foreground"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
