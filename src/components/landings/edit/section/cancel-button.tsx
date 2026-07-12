"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SectionStatus } from "./use-section-state";

// Cancel button for a section footer. Reverts the section to idle. Disabled
// while saving — cancelling mid-save would leave the state machine in an
// ambiguous place. Hidden entirely when idle (nothing to cancel) or saved
// (the success state is transient and auto-reverts).
export function CancelButton({
  status,
  onClick,
}: {
  status: SectionStatus;
  onClick: () => void;
}) {
  if (status === "idle" || status === "saved") return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={status === "saving"}
    >
      <X className="size-4" />
      Cancel
    </Button>
  );
}
