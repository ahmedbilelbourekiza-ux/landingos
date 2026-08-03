import type { WriteOption } from "@/components/console/edit-field";

/* =============================================================================
 * One setting, described by the server.
 *
 * Directive-free and imported from both sides, for the reason PROJECT_STATE now
 * records twice: a value exported from a `"use client"` module is a client
 * reference on the server, and calling it throws at runtime while the build
 * succeeds. `settingFields` below is called by the settings PAGE.
 * ========================================================================== */

export interface SettingField {
  readonly key: string;
  readonly label: string;
  readonly kind: "boolean" | "number" | "enum";
  /** Always a string on the wire; the form converts back by `kind` before sending. */
  readonly value: string;
  readonly options?: readonly WriteOption[];
  readonly min?: number;
  readonly max?: number;
}

/*
 * Note there is no list of "settings without a control" here. Which settings get
 * one is decided in the page by their declared TYPE — the structured ones
 * (`object`, `array`) are excluded because each needs an editor of its own — so
 * a structured setting added later is excluded automatically rather than
 * silently rendering as a checkbox. A hand-maintained list of names would be the
 * kind of mechanism that is correct only while somebody remembers it.
 */
