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
        <div className="flex h-full items-center justify-center">
          <ImageOff className="size-8 text-muted-foreground/40" strokeWidth={1.5} aria-hidden />
        </div>
      )}
    </div>
  );
}
