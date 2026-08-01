"use client";

import * as React from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { LandingMediaData } from "@/types/landing";

// Product gallery carousel. Supports:
// - Previous/Next arrows (hidden when only one image)
// - Thumbnail strip below (hidden when only one image)
// - Clicking a thumbnail changes the hero image
// - Keyboard navigation (Left/Right arrows on focused hero)
// - Touch swipe (RTL-aware: swipe left goes to next, swipe right goes to prev)
// - Smooth crossfade transition via Framer Motion AnimatePresence
export function ProductGallery({ media }: { media: LandingMediaData[] }) {
  const [active, setActive] = React.useState(0);
  const touchStartX = React.useRef<number | null>(null);
  const count = media.length;

  const goTo = React.useCallback(
    (index: number) => {
      if (count === 0) return;
      setActive(((index % count) + count) % count);
    },
    [count],
  );

  const next = React.useCallback(() => goTo(active + 1), [active, goTo]);
  const prev = React.useCallback(() => goTo(active - 1), [active, goTo]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); prev(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); next(); }
  };

  // Touch swipe: record start X, then on touchend compare delta.
  // Swipe left → next (RTL: content moves left), swipe right → prev.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0]?.clientX - touchStartX.current;
    if (delta < -40) next();
    else if (delta > 40) prev();
    touchStartX.current = null;
  };

  if (count === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-2xl border bg-muted text-sm text-muted-foreground">
        لا توجد صور متاحة
      </div>
    );
  }

  const current = media[active];
  const showNav = count > 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Hero image with optional navigation arrows */}
      <div
        className="group relative aspect-square overflow-hidden rounded-2xl border bg-muted/40 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        tabIndex={0}
        role="group"
        aria-label="صور المنتج، استخدم الأسهم للتنقل"
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
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

        {/* Previous button */}
        {showNav && (
          <button
            type="button"
            onClick={prev}
            aria-label="السابق"
            className="absolute left-2 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}

        {/* Next button */}
        {showNav && (
          <button
            type="button"
            onClick={next}
            aria-label="التالي"
            className="absolute right-2 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-5" />
          </button>
        )}

        {/* Counter badge */}
        {showNav && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center p-3">
            <span className="rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground backdrop-blur">
              {active + 1} / {count}
            </span>
          </div>
        )}
      </div>

      {/* Thumbnail strip (hidden when only one image) */}
      {showNav && (
        <div
          className="grid grid-cols-4 gap-2 sm:gap-3"
          role="tablist"
          aria-label="صور المنتج المصغرة"
        >
          {media.map((item, i) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={i === active}
              aria-label={`عرض الصورة ${i + 1}`}
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
                alt={item.altText ?? `صورة ${i + 1}`}
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
