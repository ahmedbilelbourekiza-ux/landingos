"use client";

import * as React from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { LandingMediaData } from "@/types/landing";

// Main product gallery. Shows one large image at a time with a smooth
// crossfade (AnimatePresence + opacity), plus a thumbnail strip for direct
// navigation. Keyboard users move between images with Left/Right on the
// focused main image; thumbnails are real buttons so they're tab-reachable.
export function ProductGallery({ media }: { media: LandingMediaData[] }) {
  const [active, setActive] = React.useState(0);
  const count = media.length;

  const goTo = React.useCallback(
    (index: number) => {
      if (count === 0) return;
      setActive(((index % count) + count) % count);
    },
    [count],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(active + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(active - 1);
    }
  };

  if (count === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-2xl border bg-muted text-sm text-muted-foreground">
        No images available
      </div>
    );
  }

  const current = media[active];

  return (
    <div className="flex flex-col gap-3">
      <div
        className="group relative aspect-square overflow-hidden rounded-2xl border bg-muted/40 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        tabIndex={0}
        role="group"
        aria-label="Product images, use arrow keys to navigate"
        onKeyDown={onKeyDown}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, scale: 1.01 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="absolute inset-0"
          >
            <Image
              src={current.url}
              alt={current.altText ?? current.url}
              fill
              priority={active === 0}
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </motion.div>
        </AnimatePresence>

        {count > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-3 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground backdrop-blur">
              {active + 1} / {count}
            </span>
          </div>
        )}
      </div>

      {count > 1 && (
        <div
          className="grid grid-cols-4 gap-2 sm:gap-3"
          role="tablist"
          aria-label="Product image thumbnails"
        >
          {media.map((item, i) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={i === active}
              aria-label={`View image ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                i === active
                  ? "border-foreground ring-1 ring-foreground"
                  : "border-border opacity-70 hover:opacity-100",
              )}
            >
              <Image
                src={item.url}
                alt={item.altText ?? `Thumbnail ${i + 1}`}
                fill
                sizes="96px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
