"use client";

import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SectionStatus } from "./use-section-state";

// Save button for a section footer. Disabled while saving (spinner shows)
// or when idle — there's nothing to save. The label stays "Save" in all
// active states for consistency; the spinner communicates the in-flight
// state without changing the text.
export function SaveButton({
  status,
  onClick,
}: {
  status: SectionStatus;
  onClick: () => void;
}) {
  const isSaving = status === "saving";
  // Disabled when saving (in flight) or when the section is idle/saved
  // (nothing to save). Enabled when dirty or error (retry).
  const isDisabled =
    isSaving || status === "idle" || status === "saved";

  return (
    <Button
      type="button"
      size="sm"
      onClick={onClick}
      disabled={isDisabled}
    >
      {isSaving ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Save className="size-4" />
      )}
      {status === "error" ? "Retry" : "Save"}
    </Button>
  );
}
