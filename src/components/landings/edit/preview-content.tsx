"use client";

import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PreviewDevice } from "./preview-device-toggle";
import type { GeneralPreviewValues } from "./sections/general-section";

// Mini landing-page preview. Renders the 4 fields the General section edits
// — announcement, title, description, CTA — in a simplified layout inside
// the selected device frame. This is NOT the full landing template; it's a
// lightweight live-preview surface that updates as the admin types.
//
// When full live preview lands (iframe to the public template), this
// component is replaced; the device frame sizing stays the same.
export function PreviewContent({
  device,
  values,
}: {
  device: PreviewDevice;
  values: GeneralPreviewValues;
}) {
  const isMobile = device === "mobile";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background",
        isMobile
          ? "mx-auto aspect-[9/19] max-w-[220px]"
          : "aspect-[16/10]",
      )}
    >
      {/* Scrollable preview body — constrained so content clips like a real page */}
      <div className="flex-1 overflow-y-auto">
        {/* Announcement bar */}
        {values.announcement ? (
          <div className="bg-foreground px-3 py-1.5 text-center text-[10px] font-medium text-background">
            <span className="line-clamp-1">{values.announcement}</span>
          </div>
        ) : (
          <div className="h-7 bg-muted/40" />
        )}

        {/* Product image placeholder */}
        <div className="flex aspect-[4/3] items-center justify-center bg-muted/30">
          <ImageOff
            className="size-8 text-muted-foreground/40"
            strokeWidth={1.5}
            aria-hidden
          />
        </div>

        {/* Text content */}
        <div className="flex flex-col gap-2 p-3">
          <motion.h3
            key={values.title}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="line-clamp-2 text-sm font-semibold tracking-tight"
          >
            {values.title || "Untitled landing page"}
          </motion.h3>

          {values.description && (
            <motion.p
              key={values.description}
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground"
            >
              {values.description}
            </motion.p>
          )}

          {/* CTA button */}
          <motion.div
            key={values.buttonText}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="mt-1"
          >
            <span className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-[11px] font-medium text-background">
              {values.buttonText || "Order Now"}
            </span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
