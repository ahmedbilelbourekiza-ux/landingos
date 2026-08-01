import type { ReactNode } from "react";

import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardHeader } from "./dashboard-header";
import { DashboardFooter } from "./dashboard-footer";

// Dashboard shell: fixed sidebar (desktop) + sticky header + scrollable main +
// sticky footer. The min-h-screen flex column guarantees the footer never
// floats when content is short, and never overlays when it's long.
//
// `mustChangePassword` is resolved in the dashboard layout (server-side) and
// threaded through to the navigation so every link except Profile is disabled
// when the admin hasn't yet changed the default password.
export function AppShell({
  children,
  mustChangePassword = false,
}: {
  children: ReactNode;
  mustChangePassword?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardSidebar mustChangePassword={mustChangePassword} />
      <div className="flex min-h-screen flex-col lg:pl-60">
        <DashboardHeader mustChangePassword={mustChangePassword} />
        <main className="flex flex-1 flex-col">{children}</main>
        <DashboardFooter />
      </div>
    </div>
  );
}
