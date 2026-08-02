"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A product's own navigation, rendered from its manifest.
 *
 * Deliberately dumb: it receives resolved hrefs and translated titles and knows
 * nothing about which product it is drawing. Filtering by permission already
 * happened in the registry — an item that reaches here is one this person may
 * see.
 */
export function ConsoleNav({
  basePath,
  items,
}: {
  basePath: string;
  items: { id: string; href: string; title: string; icon: string }[];
}) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        // The product index matches EXACTLY; everything else also matches its
        // children. Without the distinction, /builder/pages lights up both
        // "Pages" and "Overview", because every child route starts with the
        // product's base path — so the index would be highlighted on every
        // screen and stop meaning anything.
        const isIndex = item.href === basePath;
        const active = isIndex
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");

        return (
          <li key={item.id}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              {item.title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
