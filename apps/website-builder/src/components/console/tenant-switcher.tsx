"use client";

import { Building2 } from "lucide-react";

import { switchTenantAction } from "@/app/console/actions";
import { button, select as selectClass } from "./ui/styles";
import { cn } from "@/lib/utils";

/**
 * Switch company without signing in again.
 *
 * A plain form, so it works before hydration and needs no client state. Only
 * rendered when there is more than one company — a switcher with one option is
 * a control that cannot do anything.
 */
export function TenantSwitcher({
  tenants,
  activeId,
  label,
}: {
  tenants: { id: string; name: string; slug: string; role: string }[];
  activeId: string | null;
  label: string;
}) {
  const active = tenants.find((t) => t.id === activeId);

  if (tenants.length <= 1) {
    return (
      <span
        className="flex min-w-0 items-center gap-2 text-sm font-medium"
        data-testid="tenant-name"
      >
        <Building2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{active?.name ?? ""}</span>
      </span>
    );
  }

  return (
    <form action={switchTenantAction} className="flex min-w-0 items-center gap-2">
      <label htmlFor="tenantId" className="sr-only">
        {label}
      </label>
      <select
        id="tenantId"
        name="tenantId"
        defaultValue={activeId ?? ""}
        data-testid="tenant-switcher"
        className={cn(selectClass, "h-9 w-auto max-w-52 py-1.5 font-medium")}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button type="submit" className={button("default", "sm")}>
        {label}
      </button>
    </form>
  );
}
