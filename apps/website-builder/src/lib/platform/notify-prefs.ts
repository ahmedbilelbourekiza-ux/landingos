import "server-only";

import type { TenantDb } from "@landingos/db";

import { parseNotifyPrefs, type NotifyPrefs } from "./notify-vocab";

/* =============================================================================
 * Where a person's alert preference is stored — LP.11, restoring N4 and N5.
 *
 * In a call centre nobody watches the screen. An operator is on the phone with
 * their eyes on a customer's address, and the ka-ching IS the alert — which is
 * why the legacy CRM has six distinct Web Audio signatures, a per-type toggle
 * and a volume, and why a bell with no sound is most of a notification system
 * that nobody notices.
 *
 * The vocabulary, the shape and the coercion live in `notify-vocab.ts`, which
 * carries NO directive because the browser needs them too. This file is the I/O
 * half and is `server-only`.
 *
 * -----------------------------------------------------------------------------
 * D-LP.11.1 — `ProductSetting`, NOT `localStorage`
 *
 * The legacy keeps this in `localStorage`, which is the one thing it got wrong
 * here: a manager who mutes the manipulation siren on the office desktop is
 * un-muted on the laptop, on the tablet and after clearing site data. Stored
 * server-side it follows the person between devices.
 *
 * `ProductSetting` keyed `notify:<userId>` under the `platform` product — D-05.4's
 * mechanism applied to a platform concern. That table exists precisely so
 * configuration can be stored without a new table; it is tenant-scoped and
 * RLS-covered already, and no platform model has to learn what a sound
 * preference is.
 *
 * D-LP.11.2 — THE PREFERENCE IS PER (PERSON, TENANT), AND THAT IS DELIBERATE
 *
 * `ProductSetting` is tenant-scoped, so a consultant belonging to two companies
 * has two sets. That is the right answer rather than a limitation: the
 * notifications themselves are per tenant, and the volume somebody wants in a
 * COD call centre is not the volume they want in a quiet back office. A global
 * per-user preference would need a platform-wide table for one feature.
 *
 * D-LP.11.3 — THE PROVIDER READS THIS, IT DOES NOT OWN IT
 *
 * The sounds are a CLIENT concern (Web Audio needs a browser) and the preference
 * is a SERVER fact. The shell reads it once per render and passes it down,
 * exactly as it does the unread count — so a change made on the settings screen
 * or in another tab takes effect on the next render rather than never.
 * ========================================================================== */

export const PLATFORM_PRODUCT = "platform";

const PREF_KEY = (userId: string) => `notify:${userId}`;

export async function readNotifyPrefs(db: TenantDb, userId: string): Promise<NotifyPrefs> {
  const row = await db.productSetting.findFirst({
    where: { product: PLATFORM_PRODUCT, key: PREF_KEY(userId) },
    select: { value: true },
  });
  return parseNotifyPrefs(row?.value);
}

/**
 * Store a person's own preference.
 *
 * `userId` is never taken from a request body anywhere that calls this — the
 * route uses the session's own id. A preference endpoint that accepted a target
 * would let one operator silence another's manipulation siren, which is the
 * alert that exists to catch exactly that kind of behaviour.
 */
export async function writeNotifyPrefs(
  db: TenantDb,
  tenantId: string,
  userId: string,
  input: unknown,
): Promise<NotifyPrefs> {
  const next = parseNotifyPrefs(input);
  await db.productSetting.upsert({
    where: {
      tenantId_product_key: { tenantId, product: PLATFORM_PRODUCT, key: PREF_KEY(userId) },
    },
    create: {
      tenantId,
      product: PLATFORM_PRODUCT,
      key: PREF_KEY(userId),
      value: next as unknown as object,
    },
    update: { value: next as unknown as object },
  });
  return next;
}

// Re-exported so a server caller has one import. The client imports the vocab
// module directly — importing this one would drag `server-only` into the bundle
// and fail the build, which is how the split was discovered.
export {
  SOUND_FAMILIES, NOTIFY_DEFAULTS, soundFamilyOf, parseNotifyPrefs,
  type SoundFamily, type NotifyPrefs,
} from "./notify-vocab";
