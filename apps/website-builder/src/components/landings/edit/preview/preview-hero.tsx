"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PreviewState } from "@/types/preview";

/* Hero image. Crossfades when the URL changes. Shows a placeholder icon
 * when no hero is set.
 *
 * LB.13 — WHICH LANGUAGE A PREVIEW SPEAKS, decided once here for the whole
 * preview panel. Two kinds of string live in these components and they do not
 * follow the same rule:
 *
 *   - What the CUSTOMER will see — field labels, placeholders, the buy button,
 *     the shipping and total lines. These must mirror the storefront, which is
 *     Arabic by design for an Algerian buyer, and they come from the page's own
 *     config or from STOREFRONT_COPY. Rendering them in the console's locale
 *     would make the preview show something the page will never show.
 *   - What the EDITOR says ABOUT the preview — this empty state, the "Order
 *     form" caption, the untitled/unnamed fallbacks. That is the console
 *     talking to the merchant, so it follows the console's locale.
 */
export function PreviewHero({ preview }: { preview: PreviewState }) {
  const t = useTranslations();
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
          {/* `alt=""`: decorative inside a preview thumbnail — it carries no
              information the surrounding editor does not already give, and the
              old "Product hero" was English in every locale. */}
          <Image
            src={heroUrl}
            alt=""
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
            {t("builder.editor.previewNoHero")}
          </span>
          <span className="text-[9px] leading-snug text-muted-foreground/70">
            {t("builder.editor.previewNoHeroHint")}
          </span>
        </div>
      )}
    </div>
  );
}
