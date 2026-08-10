import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { can } from "@landingos/auth";
import { forTenant } from "@landingos/db";

import { requireConsoleSession } from "@/lib/console/session";
import { actionErrors } from "@/lib/console/action-errors";
import { PageHeader, PageBody, Notice } from "@/components/console/ui/primitives";
import { DomainsManager, type DomainRow } from "@/components/console/platform/domains-manager";

export const dynamic = "force-dynamic";

/* =============================================================================
 * /console/settings/domains — custom domains, B5 (CAPABILITY_AUDIT).
 *
 * The write half of a feature whose read half shipped with the schema:
 * `tenantByDomain` has refused unverified rows all along, and the bare-domain
 * root already routes a verified hostname to its own storefront (`acbc96a`).
 * This screen lets a tenant claim a hostname, prove it in DNS, choose the
 * canonical one, and unlink.
 *
 * Gated on `platform:domains:manage` — SENSITIVE, so OWNER/ADMIN only:
 * a domain decides where customer traffic goes.
 * ========================================================================== */

export default async function DomainsSettingsPage() {
  const session = await requireConsoleSession("/console/settings/domains");
  if (!session.auth || !can(session.auth, "platform:domains:manage")) notFound();

  const t = await getTranslations();
  const rows = (await forTenant(session.auth.tenantId).tenantDomain.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, domain: true, verificationToken: true,
      verifiedAt: true, isPrimary: true,
    },
  })) as unknown as Array<Omit<DomainRow, "verifiedAt"> & { verifiedAt: Date | null }>;

  // The host a CNAME should point at — the deployment's own hostname.
  const platformHost =
    process.env.PUBLIC_HOST ?? process.env.RENDER_EXTERNAL_HOSTNAME ?? "landingos.onrender.com";

  return (
    <>
      <PageBody>
      <PageHeader title={t("domains.title")} description={t("domains.hint")} />
      <Notice>{t("domains.notice")}</Notice>
      <DomainsManager
        rows={rows.map((r) => ({ ...r, verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null }))}
        platformHost={platformHost}
        s={{
          add: t("domains.add"),
          placeholder: t("domains.placeholder"),
          verify: t("domains.verify"),
          verified: t("domains.verified"),
          pending: t("domains.pending"),
          makePrimary: t("domains.makePrimary"),
          primary: t("domains.primary"),
          remove: t("domains.remove"),
          confirmRemove: t("domains.confirmRemove"),
          recordName: t("domains.recordName"),
          recordValue: t("domains.recordValue"),
          txtHint: t("domains.txtHint"),
          cnameHint: t("domains.cnameHint"),
        }}
        errors={actionErrors(t)}
      />
      </PageBody>
    </>
  );
}
