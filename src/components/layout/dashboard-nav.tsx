"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Package, Truck, FolderOpen } from "lucide-react";

import { cn } from "@/lib/utils";

export const dashboardNav = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Landing Pages", href: "/dashboard/landings", icon: FileText },
  { title: "Categories", href: "/dashboard/categories", icon: FolderOpen },
  { title: "Orders", href: "/dashboard/orders", icon: Package },
  { title: "Delivery Prices", href: "/dashboard/delivery-prices", icon: Truck },
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-1">
      {dashboardNav.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
