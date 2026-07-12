import { Badge } from "@/components/ui/badge";
import { discountPercentage, formatPrice } from "@/lib/landing/format";

// Price display: large crimson-tinted price, struck-through old price,
// and a gold discount badge for luxury feel.
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
      <span className="text-4xl font-bold tracking-tight tabular-nums" style={{ color: "var(--crimson)" }}>
        {formatPrice(price, currency)}
      </span>
      {oldPrice && off && (
        <>
          <span className="text-xl text-muted-foreground line-through tabular-nums">
            {formatPrice(oldPrice, currency)}
          </span>
          <span
            className="rounded-lg px-2.5 py-1 text-sm font-bold text-white"
            style={{ backgroundColor: "var(--gold)" }}
          >
            −{off}%
          </span>
        </>
      )}
    </div>
  );
}
