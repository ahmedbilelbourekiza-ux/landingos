"use client";

import { motion } from "framer-motion";

import type { PreviewState } from "@/types/preview";

// Product title + description. Animated on change for a subtle live-update
// feel.
export function PreviewProductInfo({ preview }: { preview: PreviewState }) {
  const { title, description } = preview.general;
  return (
    <>
      <motion.h3
        key={title}
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="line-clamp-2 text-sm font-semibold tracking-tight"
      >
        {title || "Untitled landing page"}
      </motion.h3>
      {description && (
        <motion.p
          key={description}
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground"
        >
          {description}
        </motion.p>
      )}
    </>
  );
}
