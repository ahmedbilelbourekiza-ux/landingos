"use client";

import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";
import { useOrderTotals } from "@/lib/landing/store";

export function OrderSummary({
  store,
  currency,
}: {
  store: LandingOrderStore;
  currency: string;
}) {
  const { unitPrice, subtotal } = useOrderTotals(store);
  const quantity = store((s) => s.quantity);

  const rows = [
    { label: "سعر المنتج", value: formatPrice(unitPrice, currency) },
    { label: `المجموع الفرعي × ${quantity}`, value: formatPrice(subtotal, currency) },
  ];

  return (
    <dl className="space-y-2 p-4 text-sm" style={{
      borderRadius: "var(--theme-card-radius)",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "var(--theme-border)",
      backgroundColor: "var(--theme-muted)",
    }} dir="rtl">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between">
          <dt style={{ color: "var(--theme-text)", opacity: 0.6 }}>{row.label}</dt>
          <dd className="font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
