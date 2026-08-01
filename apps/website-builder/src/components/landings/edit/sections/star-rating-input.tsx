"use client";

import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

// Interactive 1–5 star rating. Click a star to set the rating; hover to
// preview. No half stars (per spec). Keyboard accessible: focus + arrow
// keys move the rating. The value is controlled — the parent owns it.
export function StarRatingInput({
  value,
  onChange,
  size = 20,
}: {
  value: number;
  onChange: (value: number) => void;
  size?: number;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const display = hover ?? value;

  return (
    <div
      className="flex items-center gap-0.5"
      role="radiogroup"
      aria-label="Rating"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(Math.min(5, value + 1));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(Math.max(1, value - 1));
        }
      }}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const starValue = i + 1;
        const isFilled = starValue <= display;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === starValue}
            aria-label={`${starValue} star${starValue > 1 ? "s" : ""}`}
            className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(starValue)}
            onMouseEnter={() => setHover(starValue)}
            onMouseLeave={() => setHover(null)}
          >
            <Star
              style={{ width: size, height: size }}
              className={cn(
                isFilled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-muted text-muted-foreground/40",
              )}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}
