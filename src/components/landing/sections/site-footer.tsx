import { Logo } from "@/components/shared/logo";
import { siteConfig } from "@/config/site";

// Simple footer: brand, a one-line trust reminder, and copyright. No link
// columns — this is a single-product conversion page, not a corporate site.
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-10 text-center sm:px-6">
        <Logo />
        <p className="max-w-md text-sm text-muted-foreground">
          {siteConfig.description}
        </p>
        <p className="text-xs text-muted-foreground">
          © {year} {siteConfig.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
