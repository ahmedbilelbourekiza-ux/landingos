"use client";

import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PreviewDevice } from "./preview-device-toggle";

// The actual preview canvas placeholder. Renders a device-shaped frame
// (widescreen for desktop, tall narrow for mobile) with a centered
// "no preview" indicator. Swaps frames with a crossfade when the device
// changes — the only animation in the panel, kept subtle.
//
// Today this is purely decorative. When live preview lands, this component
// is replaced with an iframe pointing at the public template route; the
// device frame sizing stays the same so the panel layout doesn't shift.
export function PreviewPlaceholder({ device }: { device: PreviewDevice }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-lg border bg-muted/20",
        device === "desktop" ? "aspect-[16/10]" : "mx-auto aspect-[9/19] max-w-[220px]",
      )}
    >
      <motion.div
        key={device}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col items-center gap-2 text-muted-foreground/60"
      >
        <ImageOff className="size-6" strokeWidth={1.5} />
        <span className="text-xs">Live preview coming soon</span>
      </motion.div>
    </div>
  );
}
