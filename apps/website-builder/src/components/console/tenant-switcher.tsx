"use client";

import { switchTenantAction } from "@/app/console/actions";

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
      <span className="text-sm font-medium" data-testid="tenant-name">
        {active?.name ?? ""}
      </span>
    );
  }

  return (
    <form action={switchTenantAction} className="flex items-center gap-2">
      <label htmlFor="tenantId" className="sr-only">
        {label}
      </label>
      <select
        id="tenantId"
        name="tenantId"
        defaultValue={activeId ?? ""}
        data-testid="tenant-switcher"
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-md border border-input px-2 py-1 text-sm">
        {label}
      </button>
    </form>
  );
}
