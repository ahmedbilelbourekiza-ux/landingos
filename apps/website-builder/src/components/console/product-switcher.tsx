"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { NavIcon } from "./ui/icon";

/**
 * Switch between products without signing in again.
 *
 * The list is whatever the tenant is entitled to AND this person is permitted
 * to open — resolved in @landingos/auth, not here. A tenant on the ERP alone
 * sees one entry and no hint that anything else exists; a tenant on the bundle
 * sees both, in registration order, with neither presented as the main one.
 */
export function ProductSwitcher({
  products,
  activeId,
}: {
  products: { id: string; basePath: string; name: string; icon: string }[];
  activeId: string | null;
}) {
  if (products.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No products are enabled for this company.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="product-switcher">
      {products.map((p) => (
        <li key={p.id}>
          <Link
            href={p.basePath}
            data-product={p.id}
            aria-current={p.id === activeId ? "true" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium tap",
              "transition-colors duration-(--duration-fast) ease-standard",
              p.id === activeId
                ? "bg-primary text-primary-foreground shadow-e1"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            {/* The manifest's own icon. It has been declared per product since
                the contract was written and rendered nowhere. */}
            <NavIcon name={p.icon} className="size-4 shrink-0" />
            <span className="truncate">{p.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
