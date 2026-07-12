"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ImageOff, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
import type { PreviewDevice } from "./preview-device-toggle";
import type { PreviewState } from "@/types/preview";

// Mini landing-page preview. Reads from the single preview object owned by
// the parent. Combines pricing + variants to compute the effective price:
// base price + sum of first-option extra prices (first option is auto-
// selected in every group, matching the public landing template).
export function PreviewContent({
  device,
  preview,
}: {
  device: PreviewDevice;
  preview: PreviewState;
}) {
  const { general, pricing, images, variants } = preview;
  const isMobile = device === "mobile";

  // --- Price logic: base + variant extras ---
  // The first option in each group is auto-selected. Its extraPrice is added
  // to the base price. This matches the public template's behavior.
  const variantExtra = variants.groups.reduce((sum, g) => {
    const first = g.options[0];
    return sum + (first?.extraPrice ?? 0);
  }, 0);
  const effectivePrice = pricing.price + variantExtra;
  const effectiveShipping = pricing.freeShipping ? 0 : pricing.shipping;
  const total = effectivePrice + effectiveShipping;
  const discount = discountPercentage(effectivePrice, pricing.oldPrice);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background",
        isMobile
          ? "mx-auto aspect-[9/19] max-w-[220px]"
          : "aspect-[16/10]",
      )}
    >
      <div className="flex-1 overflow-y-auto">
        {/* Announcement bar */}
        {general.announcement ? (
          <div className="bg-foreground px-3 py-1.5 text-center text-[10px] font-medium text-background">
            <span className="line-clamp-1">{general.announcement}</span>
          </div>
        ) : (
          <div className="h-7 bg-muted/40" />
        )}

        {/* Hero image */}
        <div className="relative aspect-[4/3] bg-muted/30">
          {images.heroUrl ? (
            <motion.div
              key={images.heroUrl}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0"
            >
              <Image
                src={images.heroUrl}
                alt="Product hero"
                fill
                sizes="(max-width: 1024px) 100vw, 320px"
                className="object-cover"
              />
            </motion.div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageOff className="size-8 text-muted-foreground/40" strokeWidth={1.5} aria-hidden />
            </div>
          )}
        </div>

        {/* Gallery thumbnails */}
        {images.galleryUrls.length > 0 && (
          <div className="flex gap-1 overflow-x-auto px-2 py-1.5">
            {images.galleryUrls.slice(0, 6).map((url, i) => (
              <div key={i} className="relative size-9 shrink-0 overflow-hidden rounded border">
                <Image src={url} alt="" fill sizes="36px" className="object-cover" />
              </div>
            ))}
          </div>
        )}

        {/* Text + pricing + variants */}
        <div className="flex flex-col gap-2 p-3">
          <motion.h3
            key={general.title}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="line-clamp-2 text-sm font-semibold tracking-tight"
          >
            {general.title || "Untitled landing page"}
          </motion.h3>

          {general.description && (
            <motion.p
              key={general.description}
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground"
            >
              {general.description}
            </motion.p>
          )}

          {/* Pricing block */}
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

            {/* Variant selectors — first option of each group selected */}
            {variants.groups.length > 0 && (
              <div className="flex flex-col gap-1.5 pt-1">
                {variants.groups.map((group) => (
                  <div key={group.id} className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                      {group.name || "Group"}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {group.options.map((opt, i) => (
                        <span
                          key={opt.id}
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                            i === 0
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {opt.label || "—"}
                          {opt.extraPrice > 0 && (
                            <span className={cn("ml-0.5", i === 0 ? "text-background/70" : "")}>
                              +{formatPrice(opt.extraPrice, pricing.currency)}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

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
            key={general.buttonText}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="mt-1"
          >
            <span className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-[11px] font-medium text-background">
              {general.buttonText || "Order Now"}
            </span>
          </motion.div>
        </div>

        {/* Reviews — rendered as cards matching the public landing template.
            Shown only when there's at least one review with content. */}
        {preview.reviews.reviews.length > 0 && (
          <div className="flex flex-col gap-2 border-t bg-muted/20 p-3">
            <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              Customer Reviews
            </span>
            {preview.reviews.reviews.slice(0, 3).map((review) => (
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
        )}
      </div>
    </div>
  );
}
