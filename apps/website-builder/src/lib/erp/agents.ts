import "server-only";

import { Prisma, type TenantDb } from "@landingos/db";

import { ERP_PRODUCT } from "./settings";
import { toDecimal } from "./serialize";

/* =============================================================================
 * Per-member ERP configuration, and payroll.
 *
 * D-05.4 — WHERE THIS LIVES.
 *
 * The ERP's `agents` table did not survive the port (M-02): it was a second
 * identity system, and User + Membership replaced it. But a handful of its
 * columns were never about identity — `baseSalaryMonthly`,
 * `payPerConfirmedOrder`, `payPerDeliveredOrder`, `weeklyDaysOff`,
 * `missedOrders` — and those are ERP payroll data that has to go somewhere.
 *
 * Three options were considered:
 *
 *   1. Columns on `Membership`. Rejected outright. Membership is a PLATFORM
 *      model, and the platform must never learn what an ERP payroll rate is.
 *      A tenth product wanting its own per-member fields would want its own
 *      columns, and the table would grow a section per product — which is the
 *      exact hardcoding the registry exists to prevent.
 *
 *   2. A new ERP table keyed by userId. Correct, and a migration plus an RLS
 *      policy plus a foreign key into platform identity, for what is a small
 *      bag of settings.
 *
 *   3. `ProductSetting`, keyed `agent:<userId>`. Chosen. That table already
 *      exists precisely so a product can store configuration without a new
 *      table, it is already tenant-scoped and RLS-covered, and a tenth product
 *      needing per-member configuration uses the same mechanism unchanged.
 *
 * The cost is that these values are not queryable as columns — payroll reads
 * them per member rather than joining. For a call-centre roster, which is tens
 * of people and not thousands, that is the right trade.
 * ========================================================================== */

const AGENT_KEY = (userId: string) => `agent:${userId}`;

export interface AgentConfig {
  baseSalaryMonthly: string;
  payPerConfirmedOrder: string;
  payPerDeliveredOrder: string;
  /** 0–6, Sunday first, matching JS getDay(). */
  weeklyDaysOff: number[];
  missedOrders: number;
}

const DEFAULTS: AgentConfig = {
  baseSalaryMonthly: "0",
  payPerConfirmedOrder: "0",
  payPerDeliveredOrder: "0",
  weeklyDaysOff: [],
  missedOrders: 0,
};

/** One member's ERP configuration, with defaults filled in. */
export async function readAgentConfig(
  db: TenantDb,
  tenantId: string,
  userId: string,
): Promise<AgentConfig> {
  const row = await db.productSetting.findUnique({
    where: { tenantId_product_key: { tenantId, product: ERP_PRODUCT, key: AGENT_KEY(userId) } },
    select: { value: true },
  });
  return { ...DEFAULTS, ...((row?.value as Partial<AgentConfig>) ?? {}) };
}

/** Read every member's config in one query, for the roster and bulk payroll. */
export async function readAllAgentConfigs(db: TenantDb): Promise<Map<string, AgentConfig>> {
  const rows = await db.productSetting.findMany({
    where: { product: ERP_PRODUCT, key: { startsWith: "agent:" } },
    select: { key: true, value: true },
  });
  const out = new Map<string, AgentConfig>();
  for (const row of rows) {
    out.set(row.key.slice("agent:".length), {
      ...DEFAULTS,
      ...((row.value as Partial<AgentConfig>) ?? {}),
    });
  }
  return out;
}

export async function writeAgentConfig(
  db: TenantDb,
  tenantId: string,
  userId: string,
  patch: Partial<AgentConfig>,
): Promise<AgentConfig> {
  const current = await readAgentConfig(db, tenantId, userId);
  const next = { ...current, ...patch };
  await db.productSetting.upsert({
    where: { tenantId_product_key: { tenantId, product: ERP_PRODUCT, key: AGENT_KEY(userId) } },
    create: { tenantId, product: ERP_PRODUCT, key: AGENT_KEY(userId), value: next as never },
    update: { value: next as never },
  });
  return next;
}

/** 0–6 only. Out-of-range values are DROPPED rather than refused, as the ERP did. */
export function cleanDaysOff(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const days = input
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

export const JOB_ROLES = ["confirmation", "followup", "both"] as const;

/* -----------------------------------------------------------------------------
 * Payroll
 * -------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;

/**
 * A monthly salary, prorated across an arbitrary window by day count.
 *
 * The manager enters one monthly figure and then asks for payroll over "last
 * week" or "the 3rd to the 19th". Proration by days is what makes an arbitrary
 * range answerable at all — 30.44 is the mean month length, so a full month
 * comes back to roughly the figure that was entered rather than to a number
 * that depends on which month it was.
 */
export function prorateMonthly(monthly: Prisma.Decimal, since: number, until: number): Prisma.Decimal {
  const days = Math.max(0, (until - since) / MS_PER_DAY);
  return monthly.dividedBy(30.44).times(days);
}

export interface Payroll {
  userId: string;
  since: number;
  until: number;
  confirmedOrders: number;
  deliveredOrders: number;
  baseSalaryMonthly: string;
  payPerConfirmedOrder: string;
  payPerDeliveredOrder: string;
  salaryPay: string;
  confirmedPay: string;
  deliveredPay: string;
  totalPay: string;
}

/**
 * What one member earned over a window.
 *
 * Two counts, and the difference between them is the whole point of BUG-02.
 * CONFIRMED counts orders this agent confirmed, by creation date. DELIVERED
 * counts orders the carrier actually settled, by SETTLEMENT date — and it
 * includes orders where this person was the follow-up agent, because chasing a
 * parcel to the door is the work being paid for.
 *
 * Delivered pay was permanently zero before BUG-02 was fixed: `deliveryOutcome`
 * was read in eight places and written in none, so the column it counts on was
 * always empty and nobody was ever paid for a delivery.
 */
export async function computePayroll(
  db: TenantDb,
  userId: string,
  config: AgentConfig,
  since: number,
  until: number,
): Promise<Payroll> {
  const [confirmedOrders, deliveredOrders] = await Promise.all([
    db.fulfillmentOrder.count({
      where: {
        agentUserId: userId,
        status: "confirmed",
        createdAt: { gte: new Date(since), lte: new Date(until) },
      },
    }),
    db.fulfillmentOrder.count({
      where: {
        OR: [{ agentUserId: userId }, { followupUserId: userId }],
        deliveryOutcome: "delivered",
        deliveryOutcomeAt: { gte: new Date(since), lte: new Date(until) },
      },
    }),
  ]);

  const base = toDecimal(config.baseSalaryMonthly) ?? new Prisma.Decimal(0);
  const perConfirmed = toDecimal(config.payPerConfirmedOrder) ?? new Prisma.Decimal(0);
  const perDelivered = toDecimal(config.payPerDeliveredOrder) ?? new Prisma.Decimal(0);

  const salaryPay = prorateMonthly(base, since, until);
  const confirmedPay = perConfirmed.times(confirmedOrders);
  const deliveredPay = perDelivered.times(deliveredOrders);

  return {
    userId,
    since,
    until,
    confirmedOrders,
    deliveredOrders,
    baseSalaryMonthly: base.toString(),
    payPerConfirmedOrder: perConfirmed.toString(),
    payPerDeliveredOrder: perDelivered.toString(),
    salaryPay: salaryPay.toString(),
    confirmedPay: confirmedPay.toString(),
    deliveredPay: deliveredPay.toString(),
    totalPay: salaryPay.plus(confirmedPay).plus(deliveredPay).toString(),
  };
}
