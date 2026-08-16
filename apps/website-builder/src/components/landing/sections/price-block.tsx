import { discountPercentage, formatPrice } from "@/lib/landing/format";

export function PriceBlock({
  price,
  oldPrice,
  currency,
}: {
  price: number;
  oldPrice: number | null;
  currency: string;
}) {
  const off = discountPercentage(price, oldPrice);
  return (
    <div className="flex flex-wrap items-baseline gap-3" dir="rtl">
      <span className="text-4xl font-bold tracking-tight tabular-nums" style={{ color: "var(--theme-primary)" }}>
        {formatPrice(price, currency)}
      </span>
      {oldPrice && off && (
        <>
          {/* --theme-text-muted, NOT --theme-muted: muted is a SURFACE colour
              (order-summary paints backgrounds with it), so as ink it was
              near-invisible on every theme — measured 1.05:1 on a light
              theme. The was-price is half the discount story on a COD
              funnel; it has to be readable (LB.51). */}
          <span className="text-xl line-through tabular-nums" style={{ color: "var(--theme-text-muted)" }}>
            {formatPrice(oldPrice, currency)}
          </span>
          <span
            className="px-2.5 py-1 text-sm font-bold"
            style={{
              backgroundColor: "var(--theme-accent)",
              // Chosen by contrast against THIS theme's accent — `text-white`
              // failed the moment an accent was amber or gold (LB.51).
              color: "var(--theme-accent-foreground)",
              borderRadius: "var(--theme-badge-radius)",
            }}
          >
            −{off}%
          </span>
        </>
      )}
    </div>
  );
}
