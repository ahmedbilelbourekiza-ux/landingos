"use client";

import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";
import { useOrderTotals } from "@/lib/landing/store";

// Live order breakdown. Reads quantity and selected variants from the shared
// store and recomputes unit price, subtotal, shipping, and total on every
// change. Placed right above the purchase button so the user sees the final
// number immediately before committing.
export function OrderSummary({
  store,
  currency,
}: {
  store: LandingOrderStore;
  currency: string;
}) {
  const { unitPrice, subtotal, shipping, total } = useOrderTotals(store);
  const quantity = store((s) => s.quantity);

  const rows = [
    { label: "Unit price", value: formatPrice(unitPrice, currency) },
    { label: `Subtotal × ${quantity}`, value: formatPrice(subtotal, currency) },
    { label: "Shipping", value: formatPrice(shipping, currency) },
  ];

  return (
    <dl className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t pt-3">
        <dt className="text-base font-semibold">Total</dt>
        <dd className="text-base font-semibold tabular-nums">
          {formatPrice(total, currency)}
        </dd>
      </div>
    </dl>
  );
}
