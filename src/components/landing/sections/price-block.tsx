import { Badge } from "@/components/ui/badge";
import { discountPercentage, formatPrice } from "@/lib/landing/format";

// Price display: large current price, struck-through old price, and a
// discount badge. Visually stronger hierarchy: 4xl price, prominent badge.
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
      <span className="text-4xl font-bold tracking-tight tabular-nums">
        {formatPrice(price, currency)}
      </span>
      {oldPrice && off && (
        <>
          <span className="text-xl text-muted-foreground line-through tabular-nums">
            {formatPrice(oldPrice, currency)}
          </span>
          <Badge className="bg-emerald-500 text-white hover:bg-emerald-500 text-sm px-2.5 py-1">
            −{off}%
          </Badge>
        </>
      )}
    </div>
  );
}
