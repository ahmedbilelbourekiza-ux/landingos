"use client";

import Image from "next/image";
import { GripVertical, X, Crown } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MediaItem } from "@/lib/landing/mock-media";

// Sortable image card for the gallery. The drag handle uses dnd-kit's
// listeners; the remove button stops propagation so it doesn't trigger a
// drag. The "Set as Hero" action is a small crown button in the corner.
export function SortableImageCard({
  item,
  onRemove,
  onSetHero,
}: {
  item: MediaItem;
  onRemove: (id: string) => void;
  onSetHero: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg border bg-card",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <Image
        src={item.url}
        alt={item.filename}
        fill
        sizes="120px"
        className="object-cover"
      />

      {/* Drag handle — covers the image so the whole card is grabbable via
          the handle area. Uses dnd-kit listeners. */}
      <button
        type="button"
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        aria-label={`Drag ${item.filename}`}
        {...attributes}
        {...listeners}
      />

      {/* Hover actions overlay */}
      <div className="pointer-events-none absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="pointer-events-auto h-7 gap-1 px-2 text-xs"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSetHero(item.id);
          }}
        >
          <Crown className="size-3" />
          Hero
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="pointer-events-auto size-7"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.id);
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Filename — always visible at the bottom for context */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="line-clamp-1 text-[10px] font-medium text-white/90">
          {item.filename}
        </span>
      </div>

      {/* Drag handle indicator — top-left */}
      <span className="absolute left-1.5 top-1.5 text-white/50 opacity-0 transition-opacity group-hover:opacity-100">
        <GripVertical className="size-3.5" />
      </span>
    </div>
  );
}

// Non-sortable card for the hero image. Same visual style but no drag
// handle — the hero is promoted from the gallery, not reordered.
export function HeroImageCard({
  item,
  onRemove,
}: {
  item: MediaItem;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="group relative aspect-[16/10] overflow-hidden rounded-xl border bg-card">
      <Image
        src={item.url}
        alt={item.filename}
        fill
        sizes="(max-width: 1024px) 100vw, 600px"
        className="object-cover"
      />
      <span className="absolute left-2 top-2 rounded-md bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
        Hero
      </span>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => onRemove(item.id)}
      >
        <X className="size-3.5" />
      </Button>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <span className="text-xs font-medium text-white/90">{item.filename}</span>
      </div>
    </div>
  );
}
