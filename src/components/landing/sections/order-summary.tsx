"use client";

import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";
import { useOrderTotals } from "@/lib/landing/store";

// Live order breakdown. Shows unit price and subtotal (price × quantity).
// Shipping and total are NOT shown here — they depend on the selected wilaya
// and are displayed in the PurchaseForm after the customer selects a wilaya.
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
    { label: "Unit price", value: formatPrice(unitPrice, currency) },
    { label: `Subtotal × ${quantity}`, value: formatPrice(subtotal, currency) },
  ];

  return (
    <dl className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
