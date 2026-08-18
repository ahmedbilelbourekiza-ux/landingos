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
    /* --theme-muted-surface, NOT --theme-muted: on an extracted theme the raw
     * muted is a MID-TONE from the photograph, and this card carries the
     * price. Full-strength it measured 3.98:1 under the values and 2.47:1
     * under the opacity-thinned labels on the live page (LB.55); the surface
     * token is tinted until theme text holds AA on it. */
    <dl className="space-y-2 p-4 text-sm" style={{
      borderRadius: "var(--theme-card-radius)",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "var(--theme-border)",
      backgroundColor: "var(--theme-muted-surface)",
    }} dir="rtl">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between">
          {/* Muted by the derived ink, never by opacity — thinning theme text
           * over a themed surface is how the 2.47:1 label shipped. */}
          <dt style={{ color: "var(--theme-text-muted)" }}>{row.label}</dt>
          <dd className="font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
