"use client";

import { Globe, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Confirmation dialog shown before publishing or updating a landing page.
// The title and button text adapt based on whether it's a first publish
// or a subsequent update.
export function PublishDialog({
  open,
  onOpenChange,
  isPublishing,
  isUpdate,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPublishing: boolean;
  isUpdate: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-5" />
            {isUpdate ? "Update Landing?" : "Publish Landing?"}
          </DialogTitle>
          <DialogDescription>
            This landing will become publicly accessible. Customers can view
            it and submit orders through the purchase form.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPublishing}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPublishing}>
            {isPublishing && <Loader2 className="size-4 animate-spin" />}
            {isPublishing
              ? "Publishing..."
              : isUpdate
                ? "Update"
                : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
