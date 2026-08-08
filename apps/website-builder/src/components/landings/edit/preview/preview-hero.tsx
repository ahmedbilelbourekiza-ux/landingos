"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";

import type { PreviewState } from "@/types/preview";

// Hero image. Crossfades when the URL changes. Shows a placeholder icon
// when no hero is set.
export function PreviewHero({ preview }: { preview: PreviewState }) {
  const { heroUrl } = preview.images;
  return (
    <div className="relative aspect-[4/3] bg-muted/30">
      {heroUrl ? (
        <motion.div
          key={heroUrl}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0"
        >
          <Image
            src={heroUrl}
            alt="Product hero"
            fill
            sizes="(max-width: 1024px) 100vw, 320px"
            className="object-cover"
          />
        </motion.div>
      ) : (
        // The empty state says WHAT is missing and WHERE it is added — a bare
        // icon in a grey box read as a broken preview rather than a pending
        // choice, and "the preview looks empty" was the complaint it produced.
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
          <ImageOff className="size-6 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
          <span className="text-[10px] font-medium text-muted-foreground">
            No hero image yet
          </span>
          <span className="text-[9px] leading-snug text-muted-foreground/70">
            Add one in Images &amp; Media — it becomes the top of the page and the social share
            image.
          </span>
        </div>
      )}
    </div>
  );
}
