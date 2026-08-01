import { siteConfig } from "@/config/site";

// Sticky footer for the dashboard shell. Kept minimal: product name, version,
// and the "internal only" reminder. It sits at the bottom on short pages and
// is pushed down naturally by long content — enforced by the AppShell flex
// column with mt-auto here.
export function DashboardFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="flex h-12 items-center justify-between px-4 text-xs text-muted-foreground sm:px-6">
        <span>
          {siteConfig.name}{" "}
          <span className="text-border">·</span> v{siteConfig.version}
        </span>
        <span>Internal use only — not for public distribution</span>
      </div>
    </footer>
  );
}
