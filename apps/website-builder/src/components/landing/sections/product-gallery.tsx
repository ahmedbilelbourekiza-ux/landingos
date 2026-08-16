"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWarmupAllowed } from "@/lib/landing/use-after-load";
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
  const ready = useWarmupAllowed();

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

  /* LB.48 — lookahead. Only the ACTIVE image was ever mounted full-size (the
   * rest are 96px thumbnails), so every swipe paid a full network fetch at
   * the moment the customer asked to see the image — measured live: the
   * second image's w=1080 request fired only AFTER the arrow press. The
   * NEXT image is mounted hidden once the page has loaded, so the fetch has
   * already happened by the time a human swipes; the layer follows `active`,
   * staying one image ahead. After the load event on purpose — see
   * use-after-load.ts.
   *
   * FORWARD ONLY since LB.51, and that is a measured trade, not a tidy-up:
   * warming BOTH neighbours put two full-size images nobody may ever ask for
   * on every visitor's data plan — PageSpeed's ~226KiB "improve image
   * delivery" finding on the real page was exactly the two warmed
   * neighbours, counted ~100% wasted because the warm layer renders at
   * 1×1px. The first gesture on a gallery sitting at image 1 is
   * overwhelmingly "next"; a backward swipe pays one on-demand fetch (the
   * pre-LB.48 behaviour, once), after which the layer is warming ahead of
   * the new position again. */
  const lookahead = ready && showNav ? [(active + 1) % count].filter((i) => i !== active) : [];

  return (
    <div className="flex flex-col gap-3">
      {lookahead.length > 0 && (
        <div
          aria-hidden="true"
          style={{ position: "fixed", insetInlineStart: 0, top: 0, width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
        >
          {lookahead.map((i) => (
            <Image
              key={media[i].id}
              src={media[i].url}
              alt=""
              fill
              loading="eager"
              // The SAME sizes as the visible hero, so the browser fetches the
              // exact candidate the swipe will need — a different sizes value
              // would warm a width nobody renders.
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          ))}
        </div>
      )}
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
        {/* CSS fade on key-remount, NOT AnimatePresence (LB.49): the
            crossfade gated the swap on framer's exit animation, and under
            LazyMotion's async features the exit wedged — thumbnail selected,
            hero never swapped (measured in the browser). A keyed remount
            swaps INSTANTLY and the CSS animation fades the new image in;
            nothing about showing the product depends on JavaScript arriving. */}
        <div key={current.id} className="landing-fade absolute inset-0">
          <Image
            src={current.url}
            alt={current.altText ?? current.url}
            fill
            priority={active === 0}
            // `priority` alone preloads but leaves the fetch at default
            // priority, where it shares bandwidth with fonts and CSS; this
            // image is the page's LCP element (measured, LB.44), so it gets
            // the network's front of the line explicitly.
            fetchPriority={active === 0 ? "high" : undefined}
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />
        </div>

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
