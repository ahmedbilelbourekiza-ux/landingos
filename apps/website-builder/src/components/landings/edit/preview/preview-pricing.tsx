"use client";

import { motion } from "framer-motion";

import { formatPrice, discountPercentage } from "@/lib/landing/format";
import { unitPriceNumber } from "@/lib/landing/variant-price";
import type { PreviewState } from "@/types/preview";

// Pricing block. Shows the effective price (base + variant extras) and the
// discount badge. Shipping and total are computed in the PreviewOrderForm
// because they depend on the selected wilaya.
export function PreviewPricing({ preview }: { preview: PreviewState }) {
  const { pricing, variants } = preview;

  // The preview shows each group's first option as selected; the unit price
  // follows the same rule the storefront and the checkout use (VP.1).
  const effectivePrice = unitPriceNumber(
    pricing.price,
    variants.groups.flatMap((g) => (g.options[0] ? [g.options[0]] : [])),
  );
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
    </motion.div>
  );
}
