import "server-only";

import type { TenantDb } from "@landingos/db";

/* =============================================================================
 * ERP settings, on the platform's ProductSetting.
 *
 * The ERP had one global key/value `settings` table. On a platform that is not
 * a table, it is a bug: one company's working hours would apply to every
 * company. ProductSetting is keyed by (tenant, product, key), so a tenth
 * product stores its configuration without a new table and no tenant can see
 * another's.
 *
 * The VALIDATION is ported unchanged in behaviour from `SETTINGS_SCHEMA` and
 * `validateSettings` in apps/erp/index.js, because each rule in it was earned:
 *
 *   - Unknown keys are REFUSED, not stored. The vocabulary is fixed; a settings
 *     table that accepts anything is a scratchpad, and a typo becomes a setting
 *     that silently does nothing forever.
 *
 *   - A boolean must be an actual boolean. `if (s.autoSuspend)` is TRUE for the
 *     STRING "false", so a typo would switch on automatic account suspension
 *     for the whole company. This is the single most valuable line here.
 *
 *   - Ranges. A `workHoursEnd` at or below `workHoursStart` matches no hour at
 *     all and silently disables the overdue sweep — the accountability system
 *     stops working and nothing says so.
 *
 *   - An invalid batch changes NOTHING. Half-applying a rejected request is
 *     worse than refusing it: the caller is told it failed and half of it
 *     happened anyway.
 * ========================================================================== */

export const ERP_PRODUCT = "erp";

/** Every setting the ERP has, with its default. */
export const DEFAULT_SETTINGS = {
  autoAssign: false,
  minCallSeconds: 40,
  alertMinutes: 60,
  autoCreateShipment: true,
  trackingPollMinutes: 15,
  followupAutoAssign: false,
  followupReminderMinutes: 120,
  reservationMode: "on_confirm",
  defaultCarrierByChannel: {} as Record<string, string>,
  autoReassign: false,
  reassignMinutes: 5,
  autoSuspend: false,
  suspendThreshold: 5,
  workHoursStart: 10,
  workHoursEnd: 20,
  nightGraceMinutes: 120,
  fixedCosts: [] as Array<{ id: string; label: string; amount: string }>,
  /* LB.18 — whether this company runs the books at all.
   *
   * Defaults TRUE, so every existing tenant is unaffected by the row not
   * existing: `readSettings` overlays stored rows onto these defaults, and a
   * tenant who never touches the switch keeps the module they have today.
   *
   * It hides a MODULE, and deliberately destroys nothing. "Delete the finance
   * module" is a request to stop being shown something, not to shred the P&L —
   * `FinancialRecord` is append-only by design ("a saved P&L is a statement
   * somebody made"), and a switch that erased it would be the one action on
   * this platform with no way back. Switching it on again restores the screens
   * with their history intact. */
  financeEnabled: true,
} as const;

/* The nav items that ARE the finance module.
 *
 * One id since LB.25: the finance screen merged into the calculator (both
 * wrote the same record through the same route) and its nav item was deleted,
 * so the module IS the calculator screen now, titled Finances.
 *
 * This list lives in the ERP because only the ERP knows what its own finance
 * module consists of. The registry and the shell filter ids they are HANDED —
 * neither may learn that "finance" is a thing, which is the contract
 * `ProductManifest` exists to enforce. */
export const FINANCE_NAV_IDS = ["calculator"] as const;

/**
 * Which of this product's nav items the tenant has switched off.
 *
 * Returns ids, not knowledge: the shell hides what it is told to hide.
 */
export function hiddenErpNavIds(settings: Pick<ErpSettings, "financeEnabled">): string[] {
  return settings.financeEnabled === false ? [...FINANCE_NAV_IDS] : [];
}

/**
 * The stored settings, with every key present.
 *
 * The literal types from `DEFAULT_SETTINGS as const` are WIDENED here on
 * purpose. Without this, `autoSuspend` is typed as the literal `false` — its
 * default — so a stored `true` is unrepresentable and `settings.autoSuspend ===
 * true` is a compile error saying the two "have no overlap". A default is not a
 * domain: the whole point of these rows is that a tenant changes them.
 */
export type ErpSettings = {
  [K in keyof typeof DEFAULT_SETTINGS]: (typeof DEFAULT_SETTINGS)[K] extends boolean
    ? boolean
    : (typeof DEFAULT_SETTINGS)[K] extends number
      ? number
      : (typeof DEFAULT_SETTINGS)[K] extends string
        ? string
        : (typeof DEFAULT_SETTINGS)[K];
} & Record<string, unknown>;

export type Spec =
  | { type: "boolean" }
  | { type: "number"; min?: number; max?: number }
  | { type: "enum"; values: readonly string[] }
  | { type: "object" }
  | { type: "array" };

/**
 * Exported so the settings SCREEN builds its controls from the same table this
 * route validates against (Phase 6.3d). A form with its own list of fields is a
 * second vocabulary: it goes stale the moment a setting is added, and the way
 * that shows up is a control nobody can find rather than an error anybody sees.
 */
export const SETTINGS_SCHEMA: Record<string, Spec> = {
  autoAssign: { type: "boolean" },
  autoCreateShipment: { type: "boolean" },
  autoReassign: { type: "boolean" },
  autoSuspend: { type: "boolean" },
  followupAutoAssign: { type: "boolean" },
  // Declaring it here is all the settings SCREEN needs: that form builds its
  // controls from this table, so the switch appears without touching the page.
  financeEnabled: { type: "boolean" },
  minCallSeconds: { type: "number", min: 0, max: 3600 },
  alertMinutes: { type: "number", min: 1, max: 10080 },
  trackingPollMinutes: { type: "number", min: 1, max: 1440 },
  followupReminderMinutes: { type: "number", min: 1, max: 10080 },
  reassignMinutes: { type: "number", min: 0, max: 10080 },
  nightGraceMinutes: { type: "number", min: 0, max: 10080 },
  suspendThreshold: { type: "number", min: 1, max: 1000 },
  workHoursStart: { type: "number", min: 0, max: 23 },
  workHoursEnd: { type: "number", min: 1, max: 24 },
  reservationMode: { type: "enum", values: ["immediate", "on_confirm", "none"] },
  defaultCarrierByChannel: { type: "object" },
  fixedCosts: { type: "array" },
};

export interface Validation {
  readonly clean: Record<string, unknown>;
  readonly errors: string[];
}

/** Check one submitted batch. Never partially accepts. */
export function validateSettings(body: unknown): Validation {
  const clean: Record<string, unknown> = {};
  const errors: string[] = [];
  const input = (body ?? {}) as Record<string, unknown>;

  for (const [key, value] of Object.entries(input)) {
    // Dropped before the lookup, not rejected: a prototype key is an attack,
    // not a typo, and naming it back in an error message is free reconnaissance.
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;

    const spec = SETTINGS_SCHEMA[key];
    if (!spec) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }

    switch (spec.type) {
      case "boolean":
        if (typeof value !== "boolean") errors.push(`"${key}" must be true or false`);
        else clean[key] = value;
        break;
      case "number": {
        const n = Number(value);
        // `Number(true)` is 1, so a boolean would pass the isFinite check and
        // become a silently plausible number.
        if (typeof value === "boolean" || value === null || value === "" || !Number.isFinite(n)) {
          errors.push(`"${key}" must be a number`);
        } else if (spec.min !== undefined && n < spec.min) {
          errors.push(`"${key}" must be at least ${spec.min}`);
        } else if (spec.max !== undefined && n > spec.max) {
          errors.push(`"${key}" must be at most ${spec.max}`);
        } else {
          clean[key] = n;
        }
        break;
      }
      case "enum":
        if (typeof value !== "string" || !spec.values.includes(value)) {
          errors.push(`"${key}" must be one of: ${spec.values.join(", ")}`);
        } else clean[key] = value;
        break;
      case "array":
        if (!Array.isArray(value)) errors.push(`"${key}" must be an array`);
        else clean[key] = value;
        break;
      case "object":
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          errors.push(`"${key}" must be an object`);
        } else clean[key] = value;
        break;
    }
  }
  return { clean, errors };
}

/** Defaults, overlaid with whatever this tenant has stored. */
export async function readSettings(db: TenantDb): Promise<ErpSettings> {
  const rows = await db.productSetting.findMany({
    where: { product: ERP_PRODUCT },
    select: { key: true, value: true },
  });
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out as ErpSettings;
}

/**
 * Apply a validated batch.
 *
 * Sequential upserts rather than `$transaction`, because `withTenant` has
 * already opened one and the client it hands back has no `$transaction` at all
 * — calling it throws at runtime. Statements issued on this client are already
 * atomic together.
 */
export async function writeSettings(
  db: TenantDb,
  tenantId: string,
  clean: Record<string, unknown>,
): Promise<ErpSettings> {
  for (const [key, value] of Object.entries(clean)) {
    await db.productSetting.upsert({
      where: { tenantId_product_key: { tenantId, product: ERP_PRODUCT, key } },
      create: { tenantId, product: ERP_PRODUCT, key, value: value as never },
      update: { value: value as never },
    });
  }
  return readSettings(db);
}

/**
 * The cross-field rule, checked against the MERGED result rather than the
 * submitted keys.
 *
 * Sending `workHoursStart: 20` alone is only invalid in combination with a
 * stored `workHoursEnd` of 9 — validating the batch in isolation would accept
 * it and leave the sweep disabled.
 */
export function crossFieldError(merged: Record<string, unknown>): string | null {
  const start = Number(merged.workHoursStart);
  const end = Number(merged.workHoursEnd);
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
    return `workHoursEnd must be greater than workHoursStart (got start=${start}, end=${end})`;
  }
  return null;
}
