"use client";

import * as React from "react";
import { motion } from "framer-motion";
import type { LandingThemeData } from "@/types/theme";
import { DEFAULT_THEME } from "@/types/theme";

const ThemeContext = React.createContext<LandingThemeData>(DEFAULT_THEME);

export function useLandingTheme(): LandingThemeData {
  return React.useContext(ThemeContext);
}

/* =============================================================================
 * The landing page's theme scope.
 *
 * TWO jobs, and the second is what makes the first hold anywhere:
 *
 * 1. It declares the `--theme-*` variables the template's accent styling
 *    reads, and it PAINTS the canvas — `background-color`/`color` from the
 *    theme. Before the theme-bleed fix, `--theme-background` was written here
 *    and read by NOTHING, so the visible canvas was whatever the surrounding
 *    document painted: the console's `bg-background` body, which flips with
 *    the dark/light toggle.
 *
 * 2. It REDEFINES the console's token names (`--background`, `--card`,
 *    `--foreground`, …) for its own subtree. The template's structural
 *    sections are written in `bg-background` / `bg-card` /
 *    `text-muted-foreground` Tailwind, and next-themes stamps `.dark` on
 *    `<html>` for EVERY route — the storefront included, where it follows the
 *    VISITOR's OS preference. Tailwind v4's `@theme inline` makes each utility
 *    resolve `var(--background)` at the element it styles, so declaring the
 *    variables here means the nearest scope wins and `.dark`'s values on
 *    `:root` can never reach a landing page. A customer sees the page the
 *    merchant themed, never the customer's own dark mode — a landing page is
 *    a printed brochure, not an application surface.
 *
 * `color-scheme: light` is set for the same reason: next-themes also writes
 * `color-scheme: dark` on `<html>`, and without the override the NATIVE
 * widgets inside the purchase form (selects, date pickers) render dark
 * chrome inside a light-themed page.
 *
 * The console's `--accent` (a subtle hover surface) maps to the theme's MUTED
 * surface, not to `theme.accent` — the theme's accent is decorative ("gold:
 * icons and accents only, never buttons") and would make every hover garish.
 * `--muted-foreground` has no theme field; it is mixed from the theme's own
 * text and background so secondary text mutes WITHIN the page's palette.
 * ========================================================================== */
export function ThemeProvider({
  theme,
  className,
  children,
}: {
  theme: LandingThemeData;
  /** Layout classes for the scope element — REPLACED, not merged, because the
   *  default's `min-h-screen` is exactly what a caller with its own frame
   *  (the editor's miniature preview) must not inherit. Absent, the full-page
   *  storefront canvas. */
  className?: string;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    "--theme-primary": theme.primary,
    "--theme-primary-foreground": theme.primaryForeground,
    "--theme-accent": theme.accent,
    "--theme-background": theme.background,
    "--theme-card": theme.card,
    "--theme-text": theme.text,
    "--theme-muted": theme.muted,
    "--theme-border": theme.border,
    "--theme-card-radius": theme.cardRadius,
    "--theme-button-radius": theme.buttonRadius,
    "--theme-input-radius": theme.inputRadius,
    "--theme-card-shadow": theme.cardShadow,
    "--theme-badge-radius": theme.badgeRadius,

    // The console token names, redefined for this subtree (job 2 above).
    "--background": theme.background,
    "--foreground": theme.text,
    "--card": theme.card,
    "--card-foreground": theme.text,
    "--popover": theme.card,
    "--popover-foreground": theme.text,
    "--primary": theme.primary,
    "--primary-foreground": theme.primaryForeground,
    "--secondary": theme.muted,
    "--secondary-foreground": theme.text,
    "--muted": theme.muted,
    "--muted-foreground": `color-mix(in oklab, ${theme.text} 60%, ${theme.background})`,
    "--accent": theme.muted,
    "--accent-foreground": theme.text,
    "--border": theme.border,
    "--input": theme.border,
    "--ring": theme.primary,

    // The painted canvas — the reader `--theme-background` never had.
    backgroundColor: theme.background,
    color: theme.text,
    colorScheme: "light",
  } as React.CSSProperties;

  return (
    <ThemeContext.Provider value={theme}>
      {/* A PLAIN div owns the scope, and that is load-bearing: this element
          used to be the motion.div, and framer-motion routes `style` through
          its own pipeline, which kept serving the FIRST theme's resolved
          background after the editor switched themes — measured live, with
          the inline style already carrying the new value. A plain element's
          style follows every re-render; the motion.div now only fades the
          content and carries no style of its own. */}
      <div
        style={style}
        data-landing-theme={theme.id}
        className={className ?? "flex min-h-screen flex-col"}
      >
        <motion.div
          className="flex flex-1 flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
      </div>
    </ThemeContext.Provider>
  );
}
