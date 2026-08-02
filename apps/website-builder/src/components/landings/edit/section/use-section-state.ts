"use client";

import * as React from "react";
import { useBuilderApi } from "@/lib/builder/api-base";

// The lifecycle every edit section moves through. `dirty` collapses the
// "editing" and "unsaved" states from the spec into one — they're the same
// thing (the form has changes that haven't been saved). The shell renders
// Cancel/Save only when dirty, saving, or error; idle and saved show no
// action buttons.
export type SectionStatus =
  | "idle" // pristine — nothing edited, no buttons
  | "dirty" // has unsaved changes — shows Cancel + Save + Unsaved indicator
  | "saving" // save in flight — buttons disabled, spinner
  | "saved" // save succeeded — transient success, reverts to idle
  | "error"; // save failed — stays dirty-ish, shows error, allows retry

export interface SectionState {
  status: SectionStatus;
  error: string | null;
}

// The hook every section uses to manage its save lifecycle. The `save`
// function passed in performs the real API call; the state machine handles
// the idle → dirty → saving → saved/error transitions and exposes the
// current state for the SectionShell to render.
//
// Usage:
//   const form = useForm(...);
//   const section = useSectionState({
//     save: async () => {
//       const values = form.getValues();
//       await fetch(api(`/landings/${landingId}/general`), { ... });
//     },
//   });
//   <SectionShell state={section.state} onSave={section.save} onCancel={section.reset} ...>
//     ...form fields that call section.markDirty() onChange...
//   </SectionShell>
export function useSectionState(options: {
  save: () => Promise<void>;
  // How long the "saved" success state lingers before reverting to idle.
  // Default 1.5s — long enough to read, short enough not to annoy.
  savedDurationMs?: number;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const [status, setStatus] = React.useState<SectionStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const markDirty = React.useCallback(() => {
    setError(null);
    setStatus((prev) => (prev === "saving" ? prev : "dirty"));
  }, []);

  const reset = React.useCallback(() => {
    clearTimeout(savedTimer.current);
    setError(null);
    setStatus("idle");
  }, []);

  const save = React.useCallback(async () => {
    setStatus("saving");
    setError(null);
    try {
      await options.save();
      setStatus("saved");
      savedTimer.current = setTimeout(
        () => setStatus("idle"),
        options.savedDurationMs ?? 1500,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }, [options]);

  // Cleanup the saved→idle timer if the component unmounts mid-success.
  React.useEffect(() => () => clearTimeout(savedTimer.current), []);

  return {
    state: { status, error },
    markDirty,
    reset,
    save,
  };
}
