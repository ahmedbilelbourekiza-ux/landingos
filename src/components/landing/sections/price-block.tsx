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
          <span className="text-xl line-through tabular-nums" style={{ color: "var(--theme-muted)" }}>
            {formatPrice(oldPrice, currency)}
          </span>
          <span
            className="px-2.5 py-1 text-sm font-bold text-white"
            style={{ backgroundColor: "var(--theme-accent)", borderRadius: "var(--theme-badge-radius)" }}
          >
            −{off}%
          </span>
        </>
      )}
    </div>
  );
}
