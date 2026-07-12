"use client";

import Image from "next/image";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice } from "@/lib/landing/format";
import { formatRelative } from "@/lib/landing/date";
import type { LandingListItem } from "@/lib/landing/mock-landings";
import { LandingStatusBadge } from "./landing-status-badge";
import { LandingActionsMenu } from "./landing-actions-menu";

// Desktop table view. Hidden below the lg breakpoint where the card grid
// takes over. Columns are tuned for scannability: thumbnail + title lead,
// slug is muted, price is tabular, status is a badge, and the updated
// column uses a relative format for recency.
export function LandingTable({
  landings,
  onRowActions,
}: {
  landings: LandingListItem[];
  onRowActions?: (landing: LandingListItem) => import("./landing-actions-menu").LandingRowActions;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[42%]">Product</TableHead>
            <TableHead className="hidden md:table-cell">Slug</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Updated</TableHead>
            <TableHead className="w-12 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {landings.map((landing) => (
            <TableRow key={landing.id} className="group">
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="relative size-10 shrink-0 overflow-hidden rounded-lg border bg-muted">
                    <Image
                      src={landing.thumbnailUrl}
                      alt={landing.title}
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  </div>
                  <span className="truncate font-medium">{landing.title}</span>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  /{landing.slug}
                </code>
              </TableCell>
              <TableCell className="tabular-nums">
                {formatPrice(landing.price, landing.currency)}
              </TableCell>
              <TableCell>
                <LandingStatusBadge status={landing.status} />
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                {formatRelative(landing.updatedAt)}
              </TableCell>
              <TableCell className="text-right">
                <LandingActionsMenu
                  landing={landing}
                  actions={onRowActions ? onRowActions(landing) : {
                    onPreview: () => {}, onEdit: () => {}, onDuplicate: () => {},
                    onPublish: () => {}, onArchive: () => {}, onDelete: () => {},
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
