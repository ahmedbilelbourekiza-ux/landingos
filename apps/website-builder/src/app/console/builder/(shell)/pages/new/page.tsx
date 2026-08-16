import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@landingos/auth";
import { forTenant } from "@landingos/db";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { NewLandingForm } from "@/components/console/builder/new-landing-form";
import { GenerateLandingPanel } from "@/components/console/builder/generate-landing-panel";

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

  // LB.24 — the AI panel renders only when a model provider is configured;
  // without one it points at the AI settings screen instead of offering a
  // button that can only answer NO_AI_PROVIDER.
  const aiConfigured = Boolean(
    await forTenant(session.auth!.tenantId).aiProvider.findFirst({
      where: { active: true },
      select: { id: true },
    }),
  );

  const errors = actionErrors(t);
  // SLUG_TAKEN is this route's own refusal; said specifically rather than as
  // the generic invalid-input message, because it names the fix.
  errors.SLUG_TAKEN = t("builder.newPage.slugTaken");
  errors.NO_AI_PROVIDER = t("builder.newPage.ai.noProvider");
  errors.AI_UPSTREAM_ERROR = t("builder.newPage.ai.upstreamFailed");
  errors.AI_EMPTY_ANSWER = t("builder.newPage.ai.upstreamFailed");
  errors.AI_INVALID_OUTPUT = t("builder.newPage.ai.invalidOutput");
  errors.IMAGE_NOT_OWNED = t("builder.newPage.ai.imageNotOwned");

  return (
    <>
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

      {aiConfigured ? (
        <GenerateLandingPanel
          labels={{
            heading: t("builder.newPage.ai.heading"),
            intro: t("builder.newPage.ai.intro"),
            productName: t("builder.newPage.ai.productName"),
            price: t("builder.newPage.priceLabel"),
            oldPrice: t("builder.newPage.ai.oldPrice"),
            oldPriceHint: t("builder.newPage.ai.oldPriceHint"),
            sellingPoints: t("builder.newPage.ai.sellingPoints"),
            sellingPointsHint: t("builder.newPage.ai.sellingPointsHint"),
            photos: t("builder.newPage.ai.photos"),
            photosHint: t("builder.newPage.ai.photosHint"),
            removePhoto: t("builder.newPage.ai.removePhoto"),
            submit: t("builder.newPage.ai.generate"),
            generating: t("builder.newPage.ai.generating"),
          }}
          messages={{
            productName: t("builder.newPage.titleRequired"),
            price: t("builder.newPage.priceInvalid"),
            oldPrice: t("builder.newPage.ai.oldPriceInvalid"),
            sellingPoints: t("builder.newPage.ai.sellingPointsRequired"),
            uploadFailed: t("builder.newPage.ai.uploadFailed"),
            photosLimit: t("builder.newPage.ai.photosLimit"),
          }}
          errors={errors}
        />
      ) : (
        <div
          data-testid="ai-generate-unavailable"
          className="mt-6 max-w-lg rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
        >
          <p>{t("builder.newPage.ai.notConfigured")}</p>
          <Link href="/console/erp/ai" className="mt-2 inline-block underline">
            {t("builder.newPage.ai.configureLink")}
          </Link>
        </div>
      )}
      </PageBody>
    </>
  );
}
