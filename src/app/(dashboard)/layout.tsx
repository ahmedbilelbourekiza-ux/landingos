import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Dashboard route group — the internal admin surface. Every page under
// (dashboard) inherits the AppShell (sidebar + header + sticky footer).
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
