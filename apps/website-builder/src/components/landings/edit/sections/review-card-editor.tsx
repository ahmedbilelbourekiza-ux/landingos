"use client";

import * as React from "react";
import Image from "next/image";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, UserCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReviewItem } from "@/lib/landing/mock-reviews";
import { StarRatingInput } from "./star-rating-input";

// Sortable review editor row. Contains avatar (click to pick), name, rating
// stars, review text, and remove button. Drag handle reorders within the
// list. The avatar button opens the picker dialog (handled by the parent).
export function ReviewCardEditor({
  review,
  index,
  onChange,
  onRemove,
  onPickAvatar,
}: {
  review: ReviewItem;
  index: number;
  onChange: (id: string, patch: Partial<ReviewItem>) => void;
  onRemove: (id: string) => void;
  onPickAvatar: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: review.id });
  const t = useTranslations();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border bg-card p-3",
        isDragging && "z-10 opacity-80 shadow-md",
      )}
    >
      {/* Top row: drag handle + avatar + name + remove */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="grid size-8 shrink-0 cursor-grab place-items-center text-muted-foreground active:cursor-grabbing"
          aria-label={t("builder.editor.dragReview", { number: index + 1 })}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>

        {/* Avatar button */}
        <button
          type="button"
          onClick={() => onPickAvatar(review.id)}
          className="relative size-10 shrink-0 overflow-hidden rounded-full border-2 border-border transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("builder.editor.changeAvatar")}
        >
          {review.avatarUrl ? (
            <Image
              src={review.avatarUrl}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          ) : (
            <span className="grid h-full place-items-center bg-muted text-muted-foreground">
              <UserCircle className="size-6" />
            </span>
          )}
        </button>

        {/* Name */}
        <Input
          type="text"
          value={review.customerName}
          dir="auto"
          placeholder={t("builder.editor.fieldCustomerName")}
          aria-label={t("builder.editor.reviewNameAria", { number: index + 1 })}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange(review.id, { customerName: e.target.value })}
          className="h-8 flex-1"
        />

        {/* Remove */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t("builder.editor.removeReview", { number: index + 1 })}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(review.id)}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Rating */}
      <div className="ms-10 mt-2">
        <StarRatingInput
          value={review.rating}
          onChange={(rating) => onChange(review.id, { rating })}
          size={18}
        />
      </div>

      {/* Review text */}
      <div className="ms-10 mt-2">
        <Textarea
          value={review.reviewText}
          dir="auto"
          placeholder={t("builder.editor.reviewTextPlaceholder")}
          aria-label={t("builder.editor.reviewTextAria", { number: index + 1 })}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange(review.id, { reviewText: e.target.value })}
          rows={2}
          className="text-sm"
        />
      </div>
    </div>
  );
}
