"use client";

import * as React from "react";
import type { LandingThemeData } from "@/types/theme";
import { DEFAULT_THEME } from "@/types/theme";

const ThemeContext = React.createContext<LandingThemeData>(DEFAULT_THEME);

export function useLandingTheme(): LandingThemeData {
  return React.useContext(ThemeContext);
}

export function ThemeProvider({
  theme,
  children,
}: {
  theme: LandingThemeData;
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
  } as React.CSSProperties;

  return (
    <ThemeContext.Provider value={theme}>
      <motion.div
        style={style}
        className="flex min-h-screen flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        {children}
      </motion.div>
    </ThemeContext.Provider>
  );
}

import { motion } from "framer-motion";
