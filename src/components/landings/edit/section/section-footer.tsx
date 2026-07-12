"use client";

import { AlertCircle } from "lucide-react";

import { SaveButton } from "./save-button";
import { CancelButton } from "./cancel-button";
import type { SectionState } from "./use-section-state";

// Section footer with Cancel + Save and an error message line. Only renders
// when the section is not idle — a clean section shows no action buttons,
// keeping the workspace calm. The error message appears below the buttons
// when present, in a subtle destructive tone.
export function SectionFooter({
  state,
  onSave,
  onCancel,
}: {
  state: SectionState;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { status, error } = state;

  // Idle and saved show no footer. Saved is transient and auto-reverts to
  // idle, so there's no action to take.
  if (status === "idle" || status === "saved") return null;

  return (
    <footer className="flex flex-col gap-2 border-t px-6 py-4">
      {error && (
        <p
          className="flex items-center gap-1.5 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="size-3.5" aria-hidden />
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <CancelButton status={status} onClick={onCancel} />
        <SaveButton status={status} onClick={onSave} />
      </div>
    </footer>
  );
}
