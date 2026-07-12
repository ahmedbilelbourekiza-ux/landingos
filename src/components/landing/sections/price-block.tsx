import { Badge } from "@/components/ui/badge";
import { discountPercentage, formatPrice } from "@/lib/landing/format";

// Price display: large current price, struck-through old price, and a
// discount badge computed from the two. The badge only renders when the old
// price is genuinely higher — a 0% or negative discount would look broken.
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
    <div className="flex flex-wrap items-baseline gap-3">
      <span className="text-3xl font-semibold tracking-tight tabular-nums">
        {formatPrice(price, currency)}
      </span>
      {oldPrice && off && (
        <>
          <span className="text-lg text-muted-foreground line-through tabular-nums">
            {formatPrice(oldPrice, currency)}
          </span>
          <Badge className="bg-foreground text-background hover:bg-foreground">
            −{off}%
          </Badge>
        </>
      )}
    </div>
  );
}
