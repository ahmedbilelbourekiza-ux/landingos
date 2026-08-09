"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { iconButton } from "./ui/styles";

/* =============================================================================
 * The navigation drawer — UI.10.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. The sidebar was `hidden … md:flex` and
 * **nothing replaced it below 768px** — no drawer, no menu button, no bottom
 * bar. A signed-in operator on a phone had a page, a tenant switcher, a bell,
 * and no way to reach any other screen except by typing a URL.
 *
 * That is aimed at exactly the population this project already identified:
 * LEGACY_PARITY §6.4(c) records that the legacy agent PWA "is used by field
 * agents on Algerian mobile networks", and `/console/erp/queue` is the screen
 * ported FROM that PWA. It was reachable on a phone only from memory.
 *
 * THE SAME TREE, NOT A SECOND ONE. `children` is the navigation the shell
 * already rendered on the server for the permanent rail, handed here as well.
 * Two navigations would be two registry reads and two permission filters that
 * could disagree about what a person may see — and the one that disagreed
 * would be the one only phone users ever saw.
 *
 * The drawer's contents render only while it is open, so the server HTML
 * carries exactly one copy of the menu.
 * ========================================================================== */

export function ConsoleDrawer({
  children,
  labels,
}: {
  readonly children: ReactNode;
  readonly labels: { readonly open: string; readonly close: string; readonly navigation: string };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Choosing a destination closes the drawer. Without this it stays over the
  // screen it just navigated to, which reads as a failed tap.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes it, and the page stops scrolling underneath — the two things
  // that separate a drawer from a div that is sometimes visible.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        data-testid="console-menu"
        aria-label={labels.open}
        aria-expanded={open}
        aria-controls="console-drawer"
        onClick={() => setOpen(true)}
        className={cn(iconButton("ghost"), "md:hidden")}
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      {/* PORTALED TO <body>, and the reason is a spec trap that shipped: this
          component renders inside the console header, whose `backdrop-blur`
          makes the header the CONTAINING BLOCK for fixed descendants — so
          `fixed inset-0` pinned the overlay to the header's 55px box, and the
          drawer's contents painted over the page as unclipped overflow (seen
          on a real phone in production; reproduced at 390px). The portal
          escapes the header's containing block; open-state logic, Escape,
          scroll lock and the single-tree navigation are untouched. Safe from
          hydration mismatch because `open` is false until a click. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 md:hidden" role="presentation">
          <button
            type="button"
            aria-label={labels.close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]"
          />
          <div
            id="console-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={labels.navigation}
            className={cn(
              "absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col border-e border-sidebar-border bg-sidebar shadow-e3",
              // Fade rather than slide, deliberately: the drawer opens from the
              // INLINE start, which is the right-hand side in Arabic, and every
              // directional slide utility names a physical side. One
              // direction-neutral animation beats two that have to be kept in
              // step (R-10).
              "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
            )}
          >
            <button
              type="button"
              aria-label={labels.close}
              onClick={() => setOpen(false)}
              className={cn(iconButton("ghost", "sm"), "absolute end-2 top-2.5 z-10")}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
