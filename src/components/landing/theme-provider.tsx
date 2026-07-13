"use client";

import * as React from "react";
import type { LandingThemeData } from "@/types/theme";
import { DEFAULT_THEME } from "@/types/theme";

// Theme context — provides the active theme to all landing sections.
const ThemeContext = React.createContext<LandingThemeData>(DEFAULT_THEME);

// Hook for consuming the theme in any landing section component.
export function useLandingTheme(): LandingThemeData {
  return React.useContext(ThemeContext);
}

// Provider that injects CSS variables on a wrapper div. All child components
// use `var(--theme-primary)` etc. instead of hardcoded colors. This is the
// single entry point for theme application — no component receives colors
// via props.
export function ThemeProvider({
  theme,
  children,
}: {
  theme: LandingThemeData;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    // Semantic tokens → CSS variables
    "--theme-primary": theme.primary,
    "--theme-primary-foreground": theme.primaryForeground,
    "--theme-accent": theme.accent,
    "--theme-background": theme.background,
    "--theme-card": theme.card,
    "--theme-text": theme.text,
    "--theme-muted": theme.muted,
    "--theme-border": theme.border,
  } as React.CSSProperties;

  return (
    <ThemeContext.Provider value={theme}>
      <div style={style} className="flex min-h-screen flex-col" >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
