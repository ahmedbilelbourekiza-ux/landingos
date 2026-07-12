import { Logo } from "@/components/shared/logo";

// Minimal navigation for the landing page: just the brand mark. Public COD
// pages are single-purpose — every link is a distraction from the form — so
// the nav stays deliberately empty except for identity. Sticky with a blur
// backdrop so it stays usable while scrolling the gallery.
export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />
      </div>
    </header>
  );
}
