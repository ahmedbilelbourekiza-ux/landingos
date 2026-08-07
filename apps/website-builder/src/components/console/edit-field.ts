/* =============================================================================
 * What an editable field IS — the contract between a screen and its form.
 *
 * Like `lib/console/action-errors.ts`, this module carries no directive and is
 * imported from BOTH sides: the server describes the fields, the client renders
 * them, and `editFingerprint` is called by the server to key the panel.
 *
 * It is a separate file for a reason worth recording. `editFingerprint` first
 * lived in the `"use client"` module beside the component, and a plain function
 * exported from a client module is not a function on the server — it is a
 * client reference, and calling it throws "Attempted to call editFingerprint()
 * from the server". The BUILD SUCCEEDED and every request to the screen answered
 * 500, which is the third time this project has been bitten by a green build
 * that proves nothing.
 * ========================================================================== */

/** A choice in a select, or a labelled button. Labels are resolved server-side. */
export interface WriteOption {
  readonly value: string;
  readonly label: string;
  /** Tone variables from @landingos/ui, resolved on the server. */
  readonly vars?: Record<string, string>;
}

/**
 * One editable field, described by the server.
 *
 * `manager` says the field is in MANAGER_WRITABLE rather than AGENT_WRITABLE.
 * The page never sends those descriptors to somebody who cannot write them, so
 * the flag only captions the section — the gate is upstream.
 */
export interface EditField {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  /**
   * `image` is a string field like any other — what it holds is a URL — and it
   * is a KIND rather than a bespoke panel because the alternative was what
   * shipped before PM.2: a bare text box labelled "Image" that only somebody
   * who already had the file hosted somewhere could use. The control that
   * renders it uploads a file and puts the resulting key in the same string.
   */
  readonly kind:
    | "text"
    | "number"
    | "money"
    | "textarea"
    | "select"
    | "checkbox"
    | "image";
  readonly options?: readonly WriteOption[];
  readonly manager?: boolean;
}

/**
 * A fingerprint of what the server currently holds.
 *
 * The page uses it as the edit panel's `key`, which is where D-06.3 stops being
 * a slogan. `PATCH` does not always store what was typed — `buildPatch`
 * normalises a phone number, because that value is the customer dedup key and
 * `+213 555 12 34 56` has to be the same person as `0555123456`. Without a
 * remount the box would keep showing the typed form while the database holds
 * the normalised one, and the screen would be quietly lying about the field a
 * customer record is keyed on.
 *
 * Derived from the VALUES rather than from `updatedAt` on purpose: an unrelated
 * write — a call logged in the panel above — bumps the timestamp, and
 * remounting on that would discard whatever somebody was halfway through typing.
 */
export const editFingerprint = (fields: readonly EditField[]) =>
  fields.map((f) => `${f.name}=${f.value}`).join(" ");
