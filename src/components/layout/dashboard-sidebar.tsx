import { Logo } from "@/components/shared/logo";
import { DashboardNav } from "./dashboard-nav";

// Fixed desktop sidebar. Hidden below the lg breakpoint, where the mobile
// sheet (triggered from the header) takes over.
export function DashboardSidebar({
  mustChangePassword = false,
}: {
  mustChangePassword?: boolean;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-16 items-center border-b px-5">
        <Logo />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <DashboardNav mustChangePassword={mustChangePassword} />
      </div>
      <div className="border-t px-5 py-3">
        <p className="text-xs text-muted-foreground">Internal use only</p>
      </div>
    </aside>
  );
}
