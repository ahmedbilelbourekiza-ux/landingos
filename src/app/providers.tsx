"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

// Client-side providers mounted once in the root layout. ThemeProvider is
// first because everything else renders inside it. Future providers
// (e.g. TanStack QueryClientProvider) slot in here without touching layouts.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
