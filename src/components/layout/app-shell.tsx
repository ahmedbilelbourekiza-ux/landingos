import type { ReactNode } from "react";

import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { DashboardFooter } from "./dashboard-footer";

// Dashboard shell: fixed sidebar (desktop) + sticky header + scrollable main +
// sticky footer. The min-h-screen flex column guarantees the footer never
// floats when content is short, and never overlays when it's long.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardSidebar />
      <div className="flex min-h-screen flex-col lg:pl-60">
        <DashboardHeader />
        <main className="flex flex-1 flex-col">{children}</main>
        <DashboardFooter />
      </div>
    </div>
  );
}
