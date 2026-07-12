"use client";

import * as React from "react";

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

// The hook every section will use to manage its save lifecycle. Today the
// save is mocked — it resolves after a delay and randomly fails ~20% of the
// time so the error state is testable. When the real API lands, the `save`
// function passed in replaces the mock; the state machine stays identical.
//
// Usage in a future section:
//   const form = useForm(...);
//   const section = useSectionState({
//     save: async (values) => await fetch('/api/landings/[id]', { ... }),
//   });
//   <SectionShell state={section.state} onSave={section.save} onCancel={section.reset} ...>
//     ...form fields that call section.markDirty() onChange...
//   </SectionShell>
export function useSectionState(options?: {
  save?: () => Promise<void>;
  // How long the "saved" success state lingers before reverting to idle.
  // Default 1.5s — long enough to read, short enough not to annoy.
  savedDurationMs?: number;
}) {
  const [status, setStatus] = React.useState<SectionStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout>>();

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
      if (options?.save) {
        await options.save();
      } else {
        // Mock save: 800ms delay, ~20% failure rate so the error state is
        // exercisable in the demo. Real sections pass a real save fn.
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (Math.random() < 0.2) {
          throw new Error("Mock save failed — this is a simulated error.");
        }
      }
      setStatus("saved");
      savedTimer.current = setTimeout(() => setStatus("idle"), 1500);
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
