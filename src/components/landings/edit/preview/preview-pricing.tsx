"use client";

import { motion } from "framer-motion";

import { formatPrice, discountPercentage } from "@/lib/landing/format";
import type { PreviewState } from "@/types/preview";

// Pricing block. Owns the price computation: base price + sum of first-
// option extra prices from variants. This is the only component that
// combines two preview slices (pricing + variants) — it's the display that
// depends on both, so the logic lives here, not in PreviewContent.
export function PreviewPricing({ preview }: { preview: PreviewState }) {
  const { pricing, variants } = preview;

  const variantExtra = variants.groups.reduce((sum, g) => {
    return sum + (g.options[0]?.extraPrice ?? 0);
  }, 0);
  const effectivePrice = pricing.price + variantExtra;
  const effectiveShipping = pricing.freeShipping ? 0 : pricing.shipping;
  const total = effectivePrice + effectiveShipping;
  const discount = discountPercentage(effectivePrice, pricing.oldPrice);

  return (
    <motion.div
      key={`${effectivePrice}-${pricing.oldPrice}-${pricing.currency}`}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col gap-1.5 pt-1"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-semibold tabular-nums">
          {formatPrice(effectivePrice, pricing.currency)}
        </span>
        {pricing.oldPrice && discount && (
          <>
            <span className="text-xs text-muted-foreground line-through tabular-nums">
              {formatPrice(pricing.oldPrice, pricing.currency)}
            </span>
            <span className="rounded bg-foreground px-1.5 py-0.5 text-[9px] font-semibold text-background">
              −{discount}%
            </span>
          </>
        )}
      </div>

      <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
        <div className="flex justify-between">
          <span>Shipping</span>
          <span className="tabular-nums">
            {pricing.freeShipping
              ? "Free"
              : formatPrice(effectiveShipping, pricing.currency)}
          </span>
        </div>
        <div className="flex justify-between border-t pt-0.5 font-medium text-foreground">
          <span>Total</span>
          <span className="tabular-nums">
            {formatPrice(total, pricing.currency)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
