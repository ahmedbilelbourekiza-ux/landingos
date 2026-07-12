import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Accessible star rating. Renders filled/half/empty stars from a 0–5 value.
// `size` lets callers scale it; the reviews grid uses small stars while a
// potential aggregate badge could use larger ones.
export function StarRating({
  value,
  className,
  size = 16,
}: {
  value: number;
  className?: string;
  size?: number;
}) {
  const rounded = Math.round(value);
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${value} out of 5 stars`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={cn(
            i < rounded
              ? "fill-amber-400 text-amber-400"
              : "fill-muted text-muted",
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}
