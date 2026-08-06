/* =============================================================================
 * The alert vocabulary — LP.11.
 *
 * NO DIRECTIVE, AND THAT IS THE POINT. This module is imported from the server
 * (`notify-prefs.ts`, the shell, the route) AND from the browser (the provider,
 * the preferences panel, the synthesiser). It is the `edit-field.ts` pattern:
 * anything both sides need lives in a module carrying neither `server-only` nor
 * `"use client"`.
 *
 * The first build of this slice put these in `notify-prefs.ts`, which imports
 * `server-only`, and the whole build failed with "'server-only' cannot be
 * imported from a Client Component module" — recorded here so the split is not
 * quietly undone.
 *
 * It holds a vocabulary, a mapping and a shape. No I/O, no React, no Prisma.
 * ========================================================================== */

/**
 * The six event families the legacy CRM has signatures for.
 *
 * DERIVED FROM THE TYPES ACTUALLY RAISED, not invented: every key on the right
 * of `FAMILY_OF` is a `type` written by `lib/erp/notify.ts` or a platform
 * notifier, so a preference cannot silence a family that does not exist.
 */
export const SOUND_FAMILIES = [
  "new_order", "abandoned", "assignment", "manipulation", "delivery", "followup",
] as const;
export type SoundFamily = (typeof SOUND_FAMILIES)[number];

/**
 * Notification type → the sound family it belongs to.
 *
 * `delivery_update` and `shipment_failed` are one family because they are the
 * same event to an operator: the parcel moved and somebody has to look. The
 * suspicious-call siren is its own, because it is the only alert about a
 * COLLEAGUE rather than a customer — and the only one somebody has a motive to
 * silence for another person.
 */
const FAMILY_OF: Record<string, SoundFamily> = {
  new_order: "new_order",
  abandoned_cart: "abandoned",
  suspicious_call: "manipulation",
  agent_overdue: "manipulation",
  agent_suspended: "manipulation",
  delivery_update: "delivery",
  shipment_failed: "delivery",
  followup_raised: "followup",
  followup_overdue: "followup",
  stale_orders: "followup",
};

/**
 * An unmapped type is an ASSIGNMENT chime, never silence.
 *
 * The safe direction: a notification type added later is audible by default and
 * somebody turns it off, rather than inaudible by default and nobody ever finds
 * out it exists.
 */
export function soundFamilyOf(type: string | null | undefined): SoundFamily {
  return FAMILY_OF[type ?? ""] ?? "assignment";
}

export interface NotifyPrefs {
  /** The master switch. Off means no sound at all, whatever the six say. */
  readonly sound: boolean;
  /** 0–1. The legacy's default is 0.6 and this keeps it. */
  readonly volume: number;
  /** Per family. Absent means ON. */
  readonly families: Readonly<Record<SoundFamily, boolean>>;
  /** Raise a browser `Notification` when the tab is not visible. */
  readonly desktop: boolean;
}

export const NOTIFY_DEFAULTS: NotifyPrefs = {
  sound: true,
  volume: 0.6,
  families: Object.fromEntries(SOUND_FAMILIES.map((f) => [f, true])) as Record<SoundFamily, boolean>,
  desktop: true,
};

/**
 * Coerce whatever is stored (or posted) into something both sides can trust.
 *
 * Here rather than in the route so the shape is normalised in exactly one
 * place: the client renders from it and the server stores it, and a second
 * coercion would eventually disagree about what `volume: "loud"` means.
 */
export function parseNotifyPrefs(value: unknown): NotifyPrefs {
  const raw = (value ?? {}) as Record<string, unknown>;
  const families = (raw.families ?? {}) as Record<string, unknown>;
  const volume = Number(raw.volume);
  return {
    sound: raw.sound !== false,
    // CLAMPED rather than trusted: a stored 40 would be forty times the gain
    // the envelopes were designed for, which is a genuinely painful noise on a
    // headset. A junk value falls back to the default rather than to NaN.
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : NOTIFY_DEFAULTS.volume,
    families: Object.fromEntries(
      SOUND_FAMILIES.map((f) => [f, families[f] !== false]),
    ) as Record<SoundFamily, boolean>,
    desktop: raw.desktop !== false,
  };
}
