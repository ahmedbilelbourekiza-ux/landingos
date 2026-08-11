"use client";

import { Globe, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-5" />
            {isUpdate ? t("builder.editor.updateTitle") : t("builder.editor.publishTitle")}
          </DialogTitle>
          <DialogDescription>{t("builder.editor.publishBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPublishing}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={isPublishing}>
            {isPublishing && <Loader2 className="size-4 animate-spin" />}
            {isPublishing
              ? t("builder.editor.publishing")
              : isUpdate
                ? t("builder.editor.update")
                : t("builder.editor.publish")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
