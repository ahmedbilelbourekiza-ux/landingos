"use client";

import Image from "next/image";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PreviewState } from "@/types/preview";

// Review cards section. Renders up to 3 reviews as cards matching the public
// landing template. Shown only when there's at least one review.
export function PreviewReviews({ preview }: { preview: PreviewState }) {
  const { reviews } = preview.reviews;
  if (reviews.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/20 p-3">
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        Customer Reviews
      </span>
      {reviews.slice(0, 3).map((review) => (
        <div
          key={review.id}
          className="flex flex-col gap-1.5 rounded-lg border bg-background p-2"
        >
          <div className="flex items-center gap-1.5">
            {review.avatarUrl ? (
              <span className="relative size-6 shrink-0 overflow-hidden rounded-full">
                <Image
                  src={review.avatarUrl}
                  alt={review.customerName}
                  fill
                  sizes="24px"
                  className="object-cover"
                />
              </span>
            ) : (
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[8px] font-semibold">
                {review.customerName?.[0]?.toUpperCase() || "?"}
              </span>
            )}
            <span className="text-[10px] font-medium">
              {review.customerName || "Anonymous"}
            </span>
            <div className="flex">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    "size-2.5",
                    i < review.rating
                      ? "fill-amber-400 text-amber-400"
                      : "fill-muted text-muted-foreground/30",
                  )}
                  aria-hidden
                />
              ))}
            </div>
          </div>
          {review.reviewText && (
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              “{review.reviewText}”
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
