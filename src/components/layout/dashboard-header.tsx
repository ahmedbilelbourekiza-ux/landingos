"use client";

import { MobileSidebar } from "./mobile-sidebar";
import { ThemeToggle } from "@/components/shared/theme-toggle";

// Sticky top bar. Holds the mobile menu trigger on small screens and the
// theme toggle on all sizes. Stays a single row so it never wraps.
export function DashboardHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <MobileSidebar />
      <div className="flex-1" />
      <ThemeToggle />
    </header>
  );
}
