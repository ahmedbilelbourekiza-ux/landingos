"use client";

import * as React from "react";
import type { LandingThemeData } from "@/types/theme";
import { DEFAULT_THEME } from "@/types/theme";
import { mutedPairFor, mutedInkOn, readableTextOnHex } from "@/lib/landing/color-math";

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
 * The console's `--accent` (a subtle hover surface) maps to the theme's muted
 * SURFACE, not to `theme.accent` — the theme's accent is decorative ("gold:
 * icons and accents only, never buttons") and would make every hover garish.
 *
 * THE MUTED PAIR (LB.55). The theme contract guarantees contrast for
 * text↔background and the button pair, and says nothing about `muted` — which
 * on an extracted theme is routinely a MID-TONE lifted from the photograph.
 * Painting it full-strength under theme ink measured 2.47–3.98:1 on the live
 * page (the order summary), and the footer's 60% muted-ink mix measured
 * 3.93:1 on its tinted band — while LB.53's `--theme-text-muted` sat one
 * definition over at 78%. One rule now serves every muted use, chosen by
 * WCAG arithmetic in `mutedPairFor` rather than assumed: a SURFACE tinted
 * toward the background until full text holds AA on it, and an INK
 * strengthened from the 78% mix until it holds AA on that surface. The raw
 * `--theme-muted` remains available, but it is a decorative colour — nothing
 * that carries text may paint it full-strength.
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
  /* The muted surface/ink pair, derived with a contrast guarantee (the block
   * comment above; the arithmetic and its argument live in color-math). A
   * concrete hex rather than a CSS color-mix() so the served HTML carries an
   * assertable value and older WebViews are not asked to know color-mix. */
  const mutedPair = mutedPairFor(theme);

  const style: React.CSSProperties = {
    "--theme-primary": theme.primary,
    "--theme-primary-foreground": theme.primaryForeground,
    /* De-emphasized text ON the primary surface (the selected variant chip's
     * price hint). The guaranteed foreground softened by mutedInkOn — never
     * the background borrowed at partial opacity, which measured 2.98–4.07:1
     * on four of the six shipped palettes (19 Aug sweep). */
    "--theme-primary-foreground-muted": mutedInkOn(theme.primary, theme.primaryForeground),
    "--theme-accent": theme.accent,
    /* Text ON the accent (the discount badge). The badge hardcoded
     * `text-white`, which fails WCAG the moment a theme's accent is light —
     * amber, gold, sky — exactly the accents product photography extracts
     * (LB.51, flagged by the contrast audit). Chosen by the same
     * readable-foreground rule LB.22 uses for buttons, not assumed. */
    "--theme-accent-foreground": readableTextOnHex(theme.accent),
    /* Muted TEXT within the theme's own palette (the crossed-out old price,
     * the order summary's labels). LB.53's 78% mix, now strengthened by
     * mutedPairFor whenever 78% cannot hold AA on the muted surface. */
    "--theme-text-muted": mutedPair.ink,
    /* The muted SURFACE that may carry text — `theme.muted` tinted toward the
     * background until full text holds AA on it. The order summary paints
     * this; raw `--theme-muted` below is decorative-only. */
    "--theme-muted-surface": mutedPair.surface,
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
    /* The console's surface tokens map to the SAFE tint, not raw theme.muted:
     * the template writes `bg-muted`, `hover:bg-accent` and their /NN
     * variants under text, and a full-strength mid-tone there is the exact
     * defect the muted pair exists to close. On an already-light muted the
     * tint is visually the same surface. */
    "--secondary": mutedPair.surface,
    "--secondary-foreground": theme.text,
    "--muted": mutedPair.surface,
    /* ONE definition of muted ink — this was a second, weaker 60% mix, and
     * the footer wearing it over `bg-muted/30` measured 3.93:1 on the live
     * page while `--theme-text-muted` passed one component over. */
    "--muted-foreground": mutedPair.ink,
    "--accent": mutedPair.surface,
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
          style follows every re-render.

          The inner wrapper must stay a PLAIN div too. It was a framer fade
          (initial opacity 0), which server-rendered the ENTIRE page invisible
          until the bundle hydrated — Lighthouse measured the hero image
          downloaded and then unpainted for 2.5s on a throttled phone, 43% of
          a 5.8s LCP (LB.44). Nothing between the server HTML and the first
          paint may depend on JavaScript. */}
      <div
        style={style}
        data-landing-theme={theme.id}
        className={className ?? "flex min-h-screen flex-col"}
      >
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </ThemeContext.Provider>
  );
}
