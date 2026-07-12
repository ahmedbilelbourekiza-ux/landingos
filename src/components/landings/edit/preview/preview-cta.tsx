"use client";

import { motion } from "framer-motion";

import type { PreviewState } from "@/types/preview";

// CTA button. Renders the purchase button text on a solid background.
export function PreviewCTA({ preview }: { preview: PreviewState }) {
  const { buttonText } = preview.general;
  return (
    <motion.div
      key={buttonText}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="mt-1"
    >
      <span className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-[11px] font-medium text-background">
        {buttonText || "Order Now"}
      </span>
    </motion.div>
  );
}
