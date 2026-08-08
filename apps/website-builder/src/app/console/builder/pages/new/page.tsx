import { notFound } from "next/navigation";

import { can } from "@landingos/auth";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageBody } from "@/components/console/ui/primitives";
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
  errors.SLUG_TAKEN = "You already have a page at that address.";

  return (
    <ConsoleShell session={session} productId="website-builder">
      <PageBody>
      <h1 className="text-xl font-semibold">{t("common.create")}</h1>

      <NewLandingForm
        labels={{
          title: "Title",
          slug: "Address",
          slugHint:
            "Leave blank to generate one. Another company using the same address does not affect you.",
          price: "Price",
          submit: t("common.create"),
        }}
        messages={{
          title: "A title is required.",
          price: "Enter a price of zero or more.",
          slug: "That address cannot be used. Try letters, numbers and hyphens.",
          taken: "You already have a page at that address.",
        }}
        errors={errors}
      />
      </PageBody>
    </ConsoleShell>
  );
}
