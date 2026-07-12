"use client";

import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
import type { PreviewDevice } from "./preview-device-toggle";
import type { GeneralPreviewValues } from "./sections/general-section";
import type { PricingPreviewValues } from "./sections/pricing-section";

// Mini landing-page preview. Renders the General section's 4 display fields
// plus the Pricing section's price block — announcement, image, title,
// description, pricing, CTA — in a simplified layout inside the device frame.
// This is NOT the full landing template; it's a lightweight live-preview
// surface that updates as the admin types.
//
// When full live preview lands (iframe), this component is replaced; the
// device frame sizing stays the same.
export function PreviewContent({
  device,
  values,
  pricing,
}: {
  device: PreviewDevice;
  values: GeneralPreviewValues;
  pricing: PricingPreviewValues;
}) {
  const isMobile = device === "mobile";

  // Auto-calculated discount for the preview badge. Same formula as the
  // pricing section itself — both call discountPercentage() so they never
  // disagree.
  const discount = discountPercentage(pricing.price, pricing.oldPrice);
  const effectiveShipping = pricing.freeShipping ? 0 : pricing.shipping;
  const total = pricing.price + effectiveShipping;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background",
        isMobile
          ? "mx-auto aspect-[9/19] max-w-[220px]"
          : "aspect-[16/10]",
      )}
    >
      {/* Scrollable preview body */}
      <div className="flex-1 overflow-y-auto">
        {/* Announcement bar */}
        {values.announcement ? (
          <div className="bg-foreground px-3 py-1.5 text-center text-[10px] font-medium text-background">
            <span className="line-clamp-1">{values.announcement}</span>
          </div>
        ) : (
          <div className="h-7 bg-muted/40" />
        )}

        {/* Product image placeholder */}
        <div className="flex aspect-[4/3] items-center justify-center bg-muted/30">
          <ImageOff
            className="size-8 text-muted-foreground/40"
            strokeWidth={1.5}
            aria-hidden
          />
        </div>

        {/* Text + pricing content */}
        <div className="flex flex-col gap-2 p-3">
          <motion.h3
            key={values.title}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="line-clamp-2 text-sm font-semibold tracking-tight"
          >
            {values.title || "Untitled landing page"}
          </motion.h3>

          {values.description && (
            <motion.p
              key={values.description}
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground"
            >
              {values.description}
            </motion.p>
          )}

          {/* Pricing block — mirrors the landing template's PriceBlock.
              Price, old price strikethrough, discount badge, then
              shipping + total lines. */}
          <motion.div
            key={`${pricing.price}-${pricing.oldPrice}-${pricing.currency}`}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-1.5 pt-1"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-base font-semibold tabular-nums">
                {formatPrice(pricing.price, pricing.currency)}
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

            {/* Shipping + total */}
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

          {/* CTA button */}
          <motion.div
            key={values.buttonText}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="mt-1"
          >
            <span className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-[11px] font-medium text-background">
              {values.buttonText || "Order Now"}
            </span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
