import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { can } from "@landingos/auth";
import { withTenant } from "@landingos/db";

import { requireConsoleSession } from "@/lib/console/session";
import { actionErrors } from "@/lib/console/action-errors";
import { billingStrings } from "@/lib/console/platform-strings";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { BillingScreen } from "@/components/console/platform/billing-screen";
import { readBilling } from "@/lib/platform/billing";

export const dynamic = "force-dynamic";

/* =============================================================================
 * /console/settings/billing — Phase 7.2.
 *
 * Shows what the company has and lets an admin change it. Gated on
 * `platform:billing:read` (SENSITIVE — no role glob reaches it). The write
 * surface is gated again on `platform:billing:write`.
 *
 * The valuable property is the one the contract test proves: flip a product off
 * and save, and the next request anywhere in that product 403s — because every
 * gate re-reads `Subscription` fresh. This page is just the UI over that row.
 * ========================================================================== */

export default async function BillingSettingsPage() {
  const session = await requireConsoleSession("/console/settings/billing");
  if (!session.auth || !can(session.auth, "platform:billing:read")) notFound();

  const t = await getTranslations();
  const tenantId = session.auth!.tenantId;

  const view = await readBillingFromDb(tenantId);
  const canWrite = can(session.auth!, "platform:billing:write");
  const errors = actionErrors(t);

  // Resolve product names server-side from their manifest keys, so the client
  // holds no catalogue and cannot go stale against the registry.
  const names: Record<string, string> = {};
  for (const p of view.catalog) names[p.id] = t(p.nameKey);
  const s = billingStrings(t, names);

  const products = view.catalog.map((p) => ({
    id: p.id,
    nameKey: p.nameKey,
    descriptionKey: p.descriptionKey,
    entitlement: p.entitlement,
    enabled: view.entitlements.includes(p.entitlement),
  }));

  return (
    <>
      <PageBody>
      <PageHeader title={t("billing.title")} description={t("billing.description")} />

      <div className="mt-6">
        <BillingScreen
          products={products}
          status={view.status}
          statusLabel={t(`billing.statuses.${view.status}` as "billing.statuses.ACTIVE") || view.status}
          plan={view.plan}
          canWrite={canWrite}
          errors={errors}
          s={s}
        />
      </div>
      </PageBody>
    </>
  );
}

async function readBillingFromDb(tenantId: string) {
  return withTenant(tenantId, (db) => readBilling(db));
}
