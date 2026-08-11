"use client";

import { AlertTriangle } from "lucide-react";
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

// Warning dialog shown when the user tries to leave the edit workspace with
// unsaved changes. Gives them a chance to stay and save, or discard and
// leave.
export function LeaveWarningDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            {t("builder.editor.unsavedChanges")}
          </DialogTitle>
          <DialogDescription>{t("builder.editor.leaveBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("builder.editor.stay")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("builder.editor.leaveAnyway")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
