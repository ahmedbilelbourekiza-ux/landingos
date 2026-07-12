"use client";

import Image from "next/image";
import { Check } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { mockMediaOptions } from "@/lib/landing/mock-media";

// Mock media picker. Since there's no upload backend, the admin selects from
// a grid of pre-existing product images. Clicking an image adds it to the
// gallery and closes the dialog. Already-added images are marked but still
// selectable (adding a duplicate just re-adds it — the section dedupes by id
// when it cares, and for mock purposes duplicates are harmless).
//
// When real upload lands, this dialog gains an upload tab alongside this
// library grid; the selection mechanism stays identical.
export function MediaPickerDialog({
  open,
  onOpenChange,
  onPick,
  existingIds = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (option: { id: string; url: string; filename: string }) => void;
  existingIds?: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add image</DialogTitle>
          <DialogDescription>
            Select an image from the media library. Upload comes in a future update.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {mockMediaOptions.map((option) => {
            const isAdded = existingIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onPick({
                    id: `img-${Date.now()}-${option.id}`,
                    url: option.url,
                    filename: option.filename,
                  });
                  onOpenChange(false);
                }}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-lg border transition-all hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isAdded && "opacity-60",
                )}
              >
                <Image
                  src={option.url}
                  alt={option.filename}
                  fill
                  sizes="120px"
                  className="object-cover"
                />
                {isAdded && (
                  <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
