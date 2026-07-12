"use client";

import Image from "next/image";

import { formatPrice } from "@/lib/landing/format";
import { formatRelative } from "@/lib/landing/date";
import type { LandingListItem } from "@/lib/landing/mock-landings";
import { LandingStatusBadge } from "./landing-status-badge";
import { LandingActionsMenu } from "./landing-actions-menu";

// Mobile card row. Each landing is a single-row card: thumbnail on the left,
// title/slug/price/status stacked in the middle, actions menu on the right.
// Designed to read like a list item, not a tile — dense and scannable on a
// narrow screen.
export function LandingCard({ landing }: { landing: LandingListItem }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border bg-muted">
        <Image
          src={landing.thumbnailUrl}
          alt={landing.title}
          fill
          sizes="56px"
          className="object-cover"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{landing.title}</span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">/{landing.slug}</span>
          <span className="text-border">·</span>
          <span className="tabular-nums">
            {formatPrice(landing.price, landing.currency)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LandingStatusBadge status={landing.status} />
          <span className="text-[11px] text-muted-foreground">
            {formatRelative(landing.updatedAt)}
          </span>
        </div>
      </div>

      <LandingActionsMenu landing={landing} className="shrink-0" />
    </div>
  );
}
