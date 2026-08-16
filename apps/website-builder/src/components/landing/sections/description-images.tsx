"use client";

import Image from "next/image";

import { useWarmupAllowed } from "@/lib/landing/use-after-load";
import type { LandingMediaData } from "@/types/landing";

// Long-form images below the product, rendered top to bottom in saved order.
//
// A full-width section under the product block rather than inside the
// description paragraph: the product area is a two-column grid whose right
// column is a narrow info panel, and long-form images squeezed into it would
// render a few hundred pixels wide. Shopify places description media the same
// way, full-bleed under the buy box.
//
// Width is capped at the product grid's max-w-6xl so the images line up with
// the content above instead of running edge to edge on a wide monitor.
export function DescriptionImages({ images }: { images: LandingMediaData[] }) {
  // useWarmupAllowed, not useAfterLoad (LB.51): the eager flip below is a
  // speculative fetch too, and Save-Data visitors have declined those.
  const ready = useWarmupAllowed();
  // Renders nothing at all when empty — no heading, no spacing — so a product
  // that never uses this feature looks exactly as it did before.
  if (images.length === 0) return null;

  return (
    <section
      id="description-images"
      className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6"
      dir="rtl"
    >
      <div className="flex flex-col gap-4">
        {images.map((image, index) => (
          <div
            key={image.id}
            className="relative w-full overflow-hidden rounded-xl"
            style={{ borderRadius: "var(--theme-card-radius)" }}
          >
            <Image
              src={image.url}
              alt={image.altText ?? ""}
              width={1600}
              height={900}
              // width/height above are intrinsic hints for the optimizer; the
              // classes below let the real aspect ratio win, because these are
              // author-supplied images of arbitrary shape and cropping them to
              // a fixed box would cut off content.
              className="h-auto w-full object-contain"
              sizes="(max-width: 1024px) 100vw, 1152px"
              // ALL lazy in the SERVED HTML, the first included — LB.44
              // measured what an eager+preloaded first image did to the hero.
              // But native lazy waits for scroll PROXIMITY, and on a slow
              // phone that means the image pops in while the customer watches
              // (the real-phone report, LB.48). So once the page has LOADED,
              // the first image — the one nearest the fold — flips to eager
              // and is cached before anyone scrolls. The hero never shares
              // its bandwidth; the scroll never waits.
              loading={ready && index === 0 ? "eager" : "lazy"}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
