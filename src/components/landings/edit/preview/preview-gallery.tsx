"use client";

import Image from "next/image";

import type { PreviewState } from "@/types/preview";

// Gallery thumbnail strip. Shows up to 6 thumbnails below the hero image.
export function PreviewGallery({ preview }: { preview: PreviewState }) {
  const { galleryUrls } = preview.images;
  if (galleryUrls.length === 0) return null;
  return (
    <div className="flex gap-1 overflow-x-auto px-2 py-1.5">
      {galleryUrls.slice(0, 6).map((url, i) => (
        <div key={i} className="relative size-9 shrink-0 overflow-hidden rounded border">
          <Image src={url} alt="" fill sizes="36px" className="object-cover" />
        </div>
      ))}
    </div>
  );
}
