"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./ui/icon";
import { NavPending } from "./nav-pending";

/**
 * A product's own navigation, rendered from its manifest.
 *
 * Deliberately dumb: it receives resolved hrefs, translated titles and
 * translated group headings, and knows nothing about which product it is
 * drawing. Filtering by permission already happened in the registry — an item
 * that reaches here is one this person may see.
 *
 * UI.8/UI.9 — two things it now does that it did not.
 *
 * **It renders the icon.** `icon` has been computed by the registry, passed by
 * the shell and destructured here since Phase 4.3, and dropped on the floor.
 * Fifteen ERP items were fifteen identical lines of 14px text, which is a list
 * you read rather than a menu you aim at.
 *
 * **It renders the groups the manifest declares.** Grouping cannot be decided
 * here — the shell knowing that "orders, queue and follow-up are one job" is
 * the shell knowing what an ERP is, which is the single thing the registry
 * exists to prevent. So a product declares `group` per item and this renders
 * whatever it is handed, in declaration order, with ungrouped items leading. A
 * manifest that declares no groups gets exactly the flat list it got before.
 */

export interface NavItemView {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly icon: string;
  /** Already translated by the shell. Undefined means "no group". */
  readonly group?: string;
}

export function ConsoleNav({
  basePath,
  items,
  onNavigate,
}: {
  basePath: string;
  items: readonly NavItemView[];
  /** Lets the mobile drawer close itself when a destination is chosen. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  // Grouped by first appearance, so the order is the manifest's and nothing
  // here sorts or ranks. `undefined` is a real bucket and always comes first.
  const groups: { key: string; label?: string; items: NavItemView[] }[] = [];
  for (const item of items) {
    const key = item.group ?? "";
    let bucket = groups.find((g) => g.key === key);
    if (!bucket) {
      bucket = { key, label: item.group, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(item);
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.key}>
          {group.label && (
            <h3 className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </h3>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              // The product index matches EXACTLY; everything else also matches
              // its children. Without the distinction, /builder/pages lights up
              // both "Pages" and "Overview", because every child route starts
              // with the product's base path — so the index would be
              // highlighted on every screen and stop meaning anything.
              const isIndex = item.href === basePath;
              const active = isIndex
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/");

              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    // The manifest's own id, so a test can assert that a
                    // product's navigation came from the registry rather than
                    // from a list hardcoded in its screens.
                    data-nav={item.id}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                      "transition-colors duration-(--duration-fast) ease-standard tap",
                      active
                        ? "bg-sidebar-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                    )}
                  >
                    {/* The active marker is a bar on the INLINE START edge, so
                        it is on the left in French and on the right in Arabic
                        without a second implementation (R-10). It is drawn as
                        well as the tint because a tint alone is a colour-only
                        encoding. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute start-0 inset-y-1 w-0.5 rounded-full bg-primary",
                        "transition-opacity duration-(--duration-fast)",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <NavIcon
                      name={item.icon}
                      className={cn(
                        "size-4 shrink-0 transition-colors duration-(--duration-fast)",
                        active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground",
                      )}
                    />
                    <span className="truncate">{item.title}</span>
                    {/* UI.17 — the item you clicked says it heard you. Every
                        console screen is `force-dynamic` and runs between two
                        and eleven queries before it can paint, and until now
                        the gap between the click and the page was completely
                        silent. */}
                    <NavPending />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
