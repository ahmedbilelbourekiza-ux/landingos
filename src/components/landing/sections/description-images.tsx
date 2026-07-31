"use client";

import Image from "next/image";

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
              // Only the first image is a plausible LCP candidate; the rest sit
              // well below the fold, so eager-loading them would compete with
              // the gallery and the buy box for bandwidth.
              loading={index === 0 ? "eager" : "lazy"}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
