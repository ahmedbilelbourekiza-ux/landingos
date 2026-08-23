import { createHmac } from "crypto";

import type { TenantDb } from "@landingos/db";
import type { ErpSettings } from "./settings";

/* NO `server-only`, and NO runtime import of the ERP's own modules — the
 * calc.ts rule that `ai-quota.ts` and `rate-limit.ts` already follow. Nothing
 * here holds a secret, the policy is pure arithmetic over settings, and the
 * suite must be able to assert the hashing, the modes and the window without a
 * server. The only runtime dependency is node's own crypto; `TenantDb` and
 * `ErpSettings` are type-only and erased.
 *
 * The consequence, and it is deliberate: the phone arrives ALREADY FOLDED.
 * `normalizePhone` is `server-only`, and importing it here would drag this
 * module back out of the suite's reach for one call — so the caller folds, and
 * the contract below says so. */

/* =============================================================================
 * SEC.12 — the order-abuse rules: ONE engine, three pluggable identity keys.
 *
 * THE THREAT, stated precisely, because it decides everything below. A
 * competitor or a disgruntled coworker sits at one machine and places order
 * after order, inventing a fresh name, phone number and address each time. It
 * is SABOTAGE rather than fraud: nobody is trying to receive goods, they are
 * trying to burn the call-centre's day and poison the delivery statistics.
 *
 * That makes every customer-supplied detail worthless as an identity — those
 * are the fields being randomised. What survives is the machine and the
 * connection, so those are what the rules count.
 *
 * THREE KEYS, ONE MECHANISM. The window, the counting, the modes, the flag and
 * the console surface are identical across keys; only the identity differs. A
 * fourth key would be one entry in KEYS and one counting function, which is
 * the whole reason this is not three separate features.
 *
 *   device   the AN.2 visitor id, sent by the checkout form. One browser.
 *   network  a keyed hash of the customer IP. One connection.
 *   phone    the normalised number, counted across CHANNELS rather than just
 *            the storefront — the one key that also sees phoned-in and
 *            Shopify orders, which have no device marker at all.
 *
 * THE NETWORK KEY'S DISCRIMINATOR IS THE SUBTLE PART, and it exists to protect
 * customers rather than to catch the saboteur. Algerian mobile carriers put
 * many subscribers behind one public address, so a naive per-IP count would
 * flag a whole carrier segment — the same shared-bucket failure SEC.10 was
 * fixed for, reintroduced one layer up. But a carrier address and a saboteur
 * have OPPOSITE shapes:
 *
 *     many orders, many distinct devices  ->  a carrier. Leave it alone.
 *     many orders, one or two devices     ->  one machine. Flag it.
 *
 * So the device count is what makes the network count safe to act on, and the
 * network key is skipped entirely once an address looks shared.
 *
 * WHAT THIS DOES NOT STOP, said plainly here rather than discovered later:
 * somebody who clears site data AND re-establishes their connection between
 * every single order defeats both keys. That is achievable by hand. What the
 * rules buy is cost — sabotage stops being "submit, repeat" — and immediate
 * visibility of the lazy version, which is what someone doing this out of
 * spite actually does. The call-centre confirming every order by phone remains
 * the real backstop; this only routes their attention.
 *
 * NO `where: { tenantId }` ANYWHERE. Every count runs on the caller's bound
 * client and row-level security decides what "this tenant's orders" means —
 * rule 2 of the method, and the reason a bug here cannot read another
 * company's order volume.
 * ========================================================================== */

/** The identity kinds the engine knows. Order matters only for the reason string. */
export const ABUSE_KEYS = ["device", "network", "phone"] as const;
export type AbuseKey = (typeof ABUSE_KEYS)[number];

export type AbuseMode = "off" | "flag" | "block";

/**
 * How many DISTINCT devices on one address mean "this is a carrier, not a
 * saboteur". Deliberately a constant and not a setting: it is a heuristic a
 * merchant has no way to reason about, and the settings screen already gains
 * seven controls from this slice.
 *
 * It cannot be calibrated before launch — nothing has ever recorded an address
 * against an order, so there is no data on how many real customers share one.
 * Ship, let a week of traffic accumulate, then read the real distribution off
 * `SalesOrder` and revisit this number.
 */
export const SHARED_NETWORK_DEVICE_FLOOR = 3;

/** What the checkout knows about who is ordering, before anything is written. */
export interface AbuseIdentity {
  readonly deviceToken: string | null;
  readonly ipHash: string | null;
  /**
   * The customer's number ALREADY put through `normalizePhone` by the caller —
   * see the module header. Null when there is nothing to fold, which disarms
   * the phone key for this request rather than counting an empty string.
   */
  readonly phoneNormalized: string | null;
}

export interface AbuseVerdict {
  /** True when at least one armed key answered `block`. */
  readonly blocked: boolean;
  /**
   * The keys that tripped, joined — "device", or "device+network". Null when
   * nothing tripped. Stored on the ERP row so an agent sees WHY, and used as
   * the reason code for the refusal.
   */
  readonly reason: string | null;
  /** Per-key counts, for tests and for the server log. Never shown to a customer. */
  readonly counts: Partial<Record<AbuseKey, number>>;
}

export const NO_ABUSE: AbuseVerdict = { blocked: false, reason: null, counts: {} };

/* -----------------------------------------------------------------------------
 * The address, as something that can be grouped but not read back.
 * -------------------------------------------------------------------------- */

/**
 * A keyed hash of a customer's IP address.
 *
 * HMAC rather than a plain digest: the address space is tiny and exhaustively
 * searchable, so an unkeyed hash of an IPv4 address is a reversible encoding
 * wearing a costume. With the key it is a pseudonym, which is the whole point
 * — the rules need to know that two orders came from the same place, and
 * nothing else.
 *
 * Keyed from AUTH_SECRET, the meta/crypto pattern: every deployment already
 * has one and the app refuses to boot without it, so there is nothing new to
 * configure. Returns null when there is no address rather than hashing the
 * empty string, so "unknown" never becomes a bucket everyone shares.
 */
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip || !ip.trim()) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret || !secret.trim()) {
    // Loud in the log, harmless at the checkout: an order must never fail
    // because a fraud rule could not key its hash.
    console.error("[order-abuse] AUTH_SECRET missing; network key disabled for this request");
    return null;
  }
  return createHmac("sha256", secret).update(ip.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/* -----------------------------------------------------------------------------
 * Reading the tenant's configuration.
 * -------------------------------------------------------------------------- */

const MODES: readonly AbuseMode[] = ["off", "flag", "block"];

/** A stored mode only counts if it is one we know; anything else is `off`. */
function modeOf(value: unknown): AbuseMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
    ? (value as AbuseMode)
    : "off";
}

/** A positive whole number, or the fallback. Mirrors `parseLimitOverride`. */
function countOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface AbuseRule {
  readonly key: AbuseKey;
  readonly mode: AbuseMode;
  readonly max: number;
}

/** The three rules as this tenant has configured them, `off` ones included. */
export function rulesFrom(settings: Partial<ErpSettings>): AbuseRule[] {
  return [
    { key: "device", mode: modeOf(settings.orderAbuseDeviceMode), max: countOf(settings.orderAbuseDeviceMax, 3) },
    { key: "network", mode: modeOf(settings.orderAbuseNetworkMode), max: countOf(settings.orderAbuseNetworkMax, 3) },
    { key: "phone", mode: modeOf(settings.orderAbusePhoneMode), max: countOf(settings.orderAbusePhoneMax, 3) },
  ];
}

export function windowStart(settings: Partial<ErpSettings>, now: Date = new Date()): Date {
  const minutes = countOf(settings.orderAbuseWindowMinutes, 1440);
  return new Date(now.getTime() - minutes * 60_000);
}

/**
 * Does any rule need a database round trip at all?
 *
 * Checked before the settings are even read at the call site, so a tenant with
 * every key off pays nothing for a feature they switched off — the ordinary
 * case, and the one that must stay free.
 */
export function anyRuleArmed(settings: Partial<ErpSettings>): boolean {
  return rulesFrom(settings).some((r) => r.mode !== "off");
}

/* -----------------------------------------------------------------------------
 * The counts.
 * -------------------------------------------------------------------------- */

/**
 * Orders already placed from this device inside the window.
 *
 * EVERY order counts, whatever became of it. A cancelled order is not an
 * exemption — a saboteur's orders are precisely the ones that get cancelled,
 * so excluding them would blind the rule to its own target.
 */
async function countByDevice(db: TenantDb, token: string, since: Date): Promise<number> {
  return (db as any).salesOrder.count({ where: { deviceToken: token, createdAt: { gte: since } } });
}

/**
 * Orders from this address in the window, and how many distinct devices they
 * came from — the pair the discriminator needs.
 *
 * `findMany` of one column rather than two aggregate queries: the window holds
 * a handful of rows for any real address, and one round trip on the pinned
 * transaction beats two (D-PM.1.3).
 */
async function countByNetwork(
  db: TenantDb,
  ipHash: string,
  since: Date,
  currentDevice: string | null,
): Promise<{ orders: number; devices: number }> {
  const rows: Array<{ deviceToken: string | null }> = await (db as any).salesOrder.findMany({
    where: { ipHash, createdAt: { gte: since } },
    select: { deviceToken: true },
  });
  const devices = new Set(rows.map((r) => r.deviceToken).filter((t): t is string => Boolean(t)));
  /* THE REQUESTING DEVICE COUNTS TOO, and leaving it out was a real bug the
   * carrier test caught. Judging the third customer on a shared address, only
   * two devices are on record, so the address does not yet look shared and
   * that customer is flagged for arriving third — punished for being early to
   * a queue they did not know they were in. Counting the device now asking
   * makes the evidence complete at the moment it is used. */
  if (currentDevice) devices.add(currentDevice);
  return { orders: rows.length, devices: devices.size };
}

/**
 * Orders for this phone in the window, counted on the ERP row rather than the
 * sale.
 *
 * Deliberate: `FulfillmentOrder.phoneNormalized` is the folded form AND it
 * covers every channel — storefront, Shopify, phoned-in — which is the only
 * reason this key is worth arming at all. It also rides an index that already
 * exists, so unlike the other two it costs no new ground.
 */
async function countByPhone(db: TenantDb, phone: string, since: Date): Promise<number> {
  return (db as any).fulfillmentOrder.count({
    where: { phoneNormalized: phone, createdAt: { gte: since } },
  });
}

/* -----------------------------------------------------------------------------
 * The verdict.
 * -------------------------------------------------------------------------- */

/**
 * Judge this checkout against the tenant's armed rules.
 *
 * MUST run inside the caller's transaction, AFTER the idempotency check. That
 * ordering is load-bearing: without SEC.11 in front, six retries of one
 * purchase are six rows, and a threshold of three would refuse a customer for
 * a network problem we caused.
 *
 * Counts are of orders ALREADY placed, so `max` is how many the window ALLOWS
 * and the one after it trips: max 3 lets three through and refuses the fourth.
 * Two concurrent orders can both pass and overshoot by
 * the burst width — stated rather than serialised, exactly as the AI quota
 * states its own race. A throttle is a bound, not an accounting invariant, and
 * a per-device lock on checkout would be a far worse trade.
 */
export async function evaluateOrderAbuse(
  db: TenantDb,
  identity: AbuseIdentity,
  settings: Partial<ErpSettings>,
  now: Date = new Date(),
): Promise<AbuseVerdict> {
  if (!anyRuleArmed(settings)) return NO_ABUSE;

  const since = windowStart(settings, now);
  const counts: Partial<Record<AbuseKey, number>> = {};
  const tripped: AbuseKey[] = [];
  let blocked = false;

  for (const rule of rulesFrom(settings)) {
    if (rule.mode === "off") continue;

    let over = false;

    if (rule.key === "device") {
      if (!identity.deviceToken) continue; // No marker is not evidence. See below.
      const n = await countByDevice(db, identity.deviceToken, since);
      counts.device = n;
      over = n >= rule.max;
    }

    if (rule.key === "network") {
      if (!identity.ipHash) continue;
      const { orders, devices } = await countByNetwork(
        db,
        identity.ipHash,
        since,
        identity.deviceToken,
      );
      counts.network = orders;
      /* THE DISCRIMINATOR. An address carrying orders from several distinct
       * devices is a carrier NAT with real customers behind it, and counting
       * them together would punish all of them for each other. One or two
       * devices behind a busy address is a machine. */
      over = orders >= rule.max && devices < SHARED_NETWORK_DEVICE_FLOOR;
    }

    if (rule.key === "phone") {
      if (!identity.phoneNormalized) continue;
      const n = await countByPhone(db, identity.phoneNormalized, since);
      counts.phone = n;
      over = n >= rule.max;
    }

    if (!over) continue;
    tripped.push(rule.key);
    if (rule.mode === "block") blocked = true;
  }

  return tripped.length
    ? { blocked, reason: tripped.join("+"), counts }
    : { ...NO_ABUSE, counts };
}

/* -----------------------------------------------------------------------------
 * WHY A MISSING MARKER IS NEVER EVIDENCE
 *
 * Every key above skips when its identity is absent, and that is a decision
 * rather than an oversight. Private browsing produces no device token, and
 * plenty of ordinary customers browse that way; a rule that treated absence as
 * guilt would spend its first week flagging privacy-conscious real customers,
 * everyone would learn to ignore the badge, and the feature would be dead
 * inside a fortnight.
 *
 * Tokenless orders are not unbounded, though — they still carry an address, so
 * the network key counts them together, which is the correct bound for "some
 * machine we cannot name".
 * -------------------------------------------------------------------------- */
