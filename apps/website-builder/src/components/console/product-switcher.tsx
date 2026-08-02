"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

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
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              p.id === activeId
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            {p.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
