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
import { mockAvatarOptions } from "@/lib/landing/mock-reviews";

// Mock avatar picker. 20 options generated from 6 base images. Click to
// select; the selected avatar is highlighted with a check. When real
// upload lands, this gains an upload tab alongside the library grid.
export function AvatarPickerDialog({
  open,
  onOpenChange,
  onPick,
  selectedUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (url: string) => void;
  selectedUrl: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose avatar</DialogTitle>
          <DialogDescription>
            Select an avatar from the library. Upload comes in a future update.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {mockAvatarOptions.map((option) => {
            const isSelected = option.url === selectedUrl;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onPick(option.url);
                  onOpenChange(false);
                }}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-full border-2 transition-all hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "border-foreground",
                )}
                aria-label={option.label}
              >
                <Image
                  src={option.url}
                  alt={option.label}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
                {isSelected && (
                  <span className="absolute inset-0 grid place-items-center bg-foreground/30">
                    <Check className="size-4 text-white" />
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
