"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { useBuilderApi } from "@/lib/builder/api-base";
import { actionErrors, FALLBACK } from "@/lib/console/action-errors";

/* =============================================================================
 * LB.13 — the save path stops speaking English at an Arabic merchant.
 *
 * Every section used to do `throw new Error(json.error?.message || "Save
 * failed")`, and the footer rendered that message. `json.error.message` is the
 * platform envelope's DEVELOPER-facing sentence, written for a log and English
 * by contract (`lib/console/action-errors.ts` states the rule) — so a failed
 * save in an Arabic console said "Only a manager can change that." in English,
 * and a network drop said "Save failed".
 *
 * The console already solved this: the screen keys off the machine-readable
 * CODE and looks the reader's sentence up in the catalogue. `actionErrors` is
 * deliberately not `server-only` for exactly this reason — the server calls it
 * to translate once, a client calls it to look one up. This hook is the
 * editor's one lookup, so no section has to remember.
 * ========================================================================== */

/** A refusal the API named. Carries the CODE, never the server's prose. */
export class ApiRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ApiRefusal";
  }
}

/**
 * The one reader of a builder envelope. Every section's `save` calls this
 * instead of inventing its own message.
 */
export function refuseIfFailed(json: {
  success?: boolean;
  error?: { code?: string } | null;
}): void {
  if (json?.success) return;
  throw new ApiRefusal(String(json?.error?.code ?? ""));
}

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
  const t = useTranslations();
  // The code → reader's-sentence map, built once per section from the
  // catalogue the provider already put on the client.
  const errors = React.useMemo(() => actionErrors(t), [t]);
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
      // Three kinds of failure, said three different ways, because the fix
      // differs: the API refused and named why; `fetch` rejected, which is a
      // TypeError by spec and means the request never left; anything else is
      // a bug here and gets the honest generic sentence rather than a lie
      // about the network.
      if (e instanceof ApiRefusal) setError(errors[e.code] ?? errors[FALLBACK]);
      else if (e instanceof TypeError) setError(errors.NETWORK ?? errors[FALLBACK]);
      else setError(errors[FALLBACK]);
      setStatus("error");
    }
  }, [options, errors]);

  // Cleanup the saved→idle timer if the component unmounts mid-success.
  React.useEffect(() => () => clearTimeout(savedTimer.current), []);

  return {
    state: { status, error },
    markDirty,
    reset,
    save,
  };
}
