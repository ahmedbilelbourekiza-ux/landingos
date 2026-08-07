import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/* =============================================================================
 * A product photograph, wherever one belongs — PM.2.
 *
 * NO DIRECTIVE: server screens (products, inventory, the order detail) and the
 * client write panels both render it.
 *
 * PLAIN `<img>`, NOT `next/image`, AND THE REASON IS DATA. Two shapes end up in
 * `CatalogProduct.image` and in each variant's `image`:
 *
 *   - `/uploads/tenants/<id>/<file>` — what `POST /api/erp/uploads` returns.
 *   - `data:image/...;base64,…` — what the LEGACY CRM stores, and therefore
 *     what arrives with any tenant migrated from it (M-14 is the move off
 *     that, and until it happens both shapes are live).
 *
 * `next/image` cannot render a data URL and refuses any remote host that is not
 * allow-listed, so using it here would mean a migrated catalogue showing broken
 * images with no error anywhere. The optimiser buys little on a 40px thumbnail
 * that is already capped at 2000px by the uploader.
 *
 * THE PLACEHOLDER IS NOT DECORATION. A product with no photograph looks
 * identical to a product whose photograph failed to load, and the difference
 * decides whether somebody uploads one or files a bug. An empty frame with an
 * icon says "there is none"; a broken image icon says "something is wrong".
 * ========================================================================== */

const SIZES = {
  xs: "size-7 rounded-md",
  sm: "size-10 rounded-md",
  md: "size-14 rounded-lg",
  lg: "size-24 rounded-lg",
} as const;

const ICON = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
} as const;

export function ProductThumb({
  src,
  alt,
  size = "sm",
  className,
}: {
  readonly src?: string | null;
  /** The product or variant name. Empty string where the name is beside it and
   *  a screen reader would otherwise hear it twice. */
  readonly alt: string;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}) {
  const box = cn(
    "shrink-0 overflow-hidden border border-border bg-surface-subtle",
    SIZES[size],
    className,
  );

  if (!src) {
    return (
      <span
        data-thumb="empty"
        aria-hidden="true"
        className={cn(box, "flex items-center justify-center text-muted-foreground/60")}
      >
        <ImageIcon className={ICON[size]} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the header.
    <img
      data-thumb="image"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn(box, "object-cover")}
    />
  );
}
