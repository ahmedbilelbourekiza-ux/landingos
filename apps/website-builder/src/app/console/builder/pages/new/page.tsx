import { notFound } from "next/navigation";

import { can } from "@landingos/auth";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { NewLandingForm } from "@/components/console/builder/new-landing-form";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Create a landing page.
 *
 * Deliberately minimal: a title, an address and a price. Everything else is
 * edited afterwards in the editor, where there is room to do it properly — a
 * long creation form is a wall between someone and the thing they came to make.
 *
 * The form posts to POST /api/builder/landings through NewLandingForm — the
 * server action it replaces was a second write path (D-06.1) that fired no
 * `product.created` webhook, so a page created here was invisible to every
 * subscribed CRM (LB.10).
 * ========================================================================== */

export default async function NewLandingPage() {
  const { session, t } = await requireProduct("website-builder", "/console/builder/pages/new");
  if (!can(session.auth!, "website-builder:pages:write")) notFound();

  const errors = actionErrors(t);
  // SLUG_TAKEN is this route's own refusal; said specifically rather than as
  // the generic invalid-input message, because it names the fix.
  errors.SLUG_TAKEN = t("builder.newPage.slugTaken");

  return (
    <ConsoleShell session={session} productId="website-builder">
      <PageBody>
      <PageHeader
        title={t("builder.newPage.title")}
        breadcrumb={[
          { label: t("builder.nav.pages"), href: "/console/builder/pages" },
          { label: t("builder.newPage.title") },
        ]}
      />

      <NewLandingForm
        labels={{
          title: t("builder.newPage.titleLabel"),
          slug: t("builder.newPage.slugLabel"),
          slugHint: t("builder.newPage.slugHint"),
          price: t("builder.newPage.priceLabel"),
          submit: t("common.create"),
        }}
        messages={{
          title: t("builder.newPage.titleRequired"),
          price: t("builder.newPage.priceInvalid"),
          slug: t("builder.newPage.slugInvalid"),
          taken: t("builder.newPage.slugTaken"),
        }}
        errors={errors}
      />
      </PageBody>
    </ConsoleShell>
  );
}
