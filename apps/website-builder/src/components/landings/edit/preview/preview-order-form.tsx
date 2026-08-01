"use client";

import * as React from "react";
import { formatPrice } from "@/lib/landing/format";
import type { PreviewState } from "@/types/preview";
import { normalizeOrder } from "@/lib/landing/mock-order-form";

// Order form preview. Renders the configured form fields plus a wilaya
// selector (loaded from the API) and a baladia selector that filters by the
// selected wilaya. When a wilaya is selected, the shipping price is looked
// up from the delivery slice and the total updates instantly.
export function PreviewOrderForm({ preview }: { preview: PreviewState }) {
  const { config } = preview.orderForm;
  const [wilayas, setWilayas] = React.useState<{
    id: number;
    name: string;
    baladias: { id: number; name: string }[];
  }[]>([]);
  const [selectedWilaya, setSelectedWilaya] = React.useState<number | "">("");
  const [selectedBaladia, setSelectedBaladia] = React.useState<number | "">("");
  const [deliveryPrices, setDeliveryPrices] = React.useState<Record<number, number>>({});

  // Load wilayas + global delivery prices on mount
  React.useEffect(() => {
    Promise.all([
      fetch("/api/wilayas").then((r) => r.json()),
      fetch("/api/settings/delivery-prices").then((r) => r.json()),
    ]).then(([wJson, pJson]) => {
      if (wJson.success) setWilayas(wJson.data);
      if (pJson.success) {
        const map: Record<number, number> = {};
        for (const p of pJson.data) {
          if (p.homePrice !== null) map[p.id] = p.homePrice;
        }
        setDeliveryPrices(map);
      }
    });
  }, []);

  // Driven by the configured order rather than a hardcoded list, so dragging
  // a field in the editor moves it here immediately. Indexing by FieldKey
  // (not `keyof OrderFormConfig`) keeps the element type OrderFormField —
  // the config also holds `order` and `buttonText`, which are not fields.
  const visibleFields = normalizeOrder(config.order).filter(
    (k) => config[k]?.visible,
  );

  // Find the selected wilaya's delivery price from global settings
  const shipping = deliveryPrices[Number(selectedWilaya)] ?? 0;

  // Compute effective price (base + variant extras + shipping)
  const variantExtra = preview.variants.groups.reduce((sum, g) => {
    return sum + (g.options[0]?.extraPrice ?? 0);
  }, 0);
  const effectivePrice = preview.pricing.price + variantExtra;
  const total = effectivePrice + shipping;

  const selectedWilayaData = wilayas.find((w) => w.id === Number(selectedWilaya));

  if (visibleFields.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t bg-muted/20 p-3">
      <span className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        Order Form
      </span>

      {/* Regular fields (except wilaya/baladia which get special selectors) */}
      {visibleFields
        .filter((k) => k !== "wilaya" && k !== "baladia")
        .map((key) => {
          const field = config[key];
          return (
            <div key={key} className="flex flex-col gap-0.5">
              <span className="text-[9px] font-medium text-foreground">
                {field.label || key}
                {field.required && <span className="ml-0.5 text-destructive">*</span>}
              </span>
              <span className="rounded border border-border bg-background px-1.5 py-1 text-[9px] text-muted-foreground/60">
                {field.placeholder || "—"}
              </span>
            </div>
          );
        })}

      {/* Wilaya selector */}
      {config.wilaya?.visible && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-medium text-foreground">
            {config.wilaya.label || "Wilaya"}
            {config.wilaya.required && <span className="ml-0.5 text-destructive">*</span>}
          </span>
          <select
            value={selectedWilaya}
            onChange={(e) => {
              setSelectedWilaya(e.target.value ? Number(e.target.value) : "");
              setSelectedBaladia("");
            }}
            className="rounded border border-border bg-background px-1.5 py-1 text-[9px] text-foreground"
          >
            <option value="">Select wilaya...</option>
            {wilayas.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Baladia selector — only shows communes for the selected wilaya */}
      {config.baladia?.visible && selectedWilayaData && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-medium text-foreground">
            {config.baladia.label || "Baladia"}
            {config.baladia.required && <span className="ml-0.5 text-destructive">*</span>}
          </span>
          <select
            value={selectedBaladia}
            onChange={(e) => setSelectedBaladia(e.target.value ? Number(e.target.value) : "")}
            className="rounded border border-border bg-background px-1.5 py-1 text-[9px] text-foreground"
          >
            <option value="">Select commune...</option>
            {selectedWilayaData.baladias.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Shipping + Total (only when a wilaya is selected) */}
      {selectedWilaya !== "" && (
        <div className="mt-0.5 flex flex-col gap-0.5 text-[9px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Shipping</span>
            <span className="tabular-nums">
              {shipping > 0 ? formatPrice(shipping, preview.pricing.currency) : "—"}
            </span>
          </div>
          <div className="flex justify-between border-t pt-0.5 font-medium text-foreground">
            <span>Total</span>
            <span className="tabular-nums">
              {formatPrice(total, preview.pricing.currency)}
            </span>
          </div>
        </div>
      )}

      {/* Submit button */}
      <span className="mt-1 inline-flex items-center justify-center rounded-md bg-foreground px-3 py-1.5 text-[10px] font-medium text-background">
        {config.buttonText || "Order Now"}
      </span>
    </div>
  );
}
