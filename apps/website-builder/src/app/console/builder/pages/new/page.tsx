import { notFound, redirect } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageBody } from "@/components/console/ui/primitives";
import { slugify } from "@/lib/landing/create";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Create a landing page.
 *
 * Deliberately minimal: a title, an address and a price. Everything else is
 * edited afterwards in the editor, where there is room to do it properly — a
 * long creation form is a wall between someone and the thing they came to make.
 * ========================================================================== */

async function create(formData: FormData) {
  "use server";
  const { session } = await requireProduct("website-builder", "/console/builder/pages/new");
  if (!can(session.auth!, "website-builder:pages:write")) notFound();

  const title = String(formData.get("title") ?? "").trim();
  const price = Number(String(formData.get("price") ?? "").trim());
  const rawSlug = String(formData.get("slug") ?? "").trim();

  if (!title) redirect("/console/builder/pages/new?error=title");
  if (!Number.isFinite(price) || price < 0) redirect("/console/builder/pages/new?error=price");

  // Derive from the title when left blank, so nobody has to know what a slug is.
  const slug = slugify(rawSlug || title);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) redirect("/console/builder/pages/new?error=slug");

  const tenantId = session.auth!.tenantId;
  const id = await withTenant(tenantId, async (db) => {
    // Per-tenant uniqueness (M-04): another company owning this slug is fine.
    const clash = await (db as any).landingPage.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (clash) return null;

    const created = await (db as any).landingPage.create({
      data: { tenantId, title: title.slice(0, 200), slug, price },
      select: { id: true },
    });
    return created.id as string;
  });

  if (!id) redirect("/console/builder/pages/new?error=taken");
  // Straight into the editor — creating a page is the start of editing it.
  redirect(`/console/builder/pages/${id}/edit`);
}

export default async function NewLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { session, t } = await requireProduct("website-builder", "/console/builder/pages/new");
  if (!can(session.auth!, "website-builder:pages:write")) notFound();

  const { error } = await searchParams;
  const messages: Record<string, string> = {
    title: "A title is required.",
    price: "Enter a price of zero or more.",
    slug: "That address cannot be used. Try letters, numbers and hyphens.",
    taken: "You already have a page at that address.",
  };

  return (
    <ConsoleShell session={session} productId="website-builder">
      <PageBody>
      <h1 className="text-xl font-semibold">{t("common.create")}</h1>

      {error ? (
        <p
          role="alert"
          data-testid="error"
          className="mt-4 max-w-lg rounded-md border px-3 py-2 text-sm"
          style={{
            color: "var(--danger-fg)",
            backgroundColor: "var(--danger-bg)",
            borderColor: "var(--danger-border)",
          }}
        >
          {messages[error] ?? "That did not work."}
        </p>
      ) : null}

      <form
        action={create}
        data-testid="new-landing-form"
        className="mt-6 max-w-lg space-y-4 rounded-lg border border-border bg-card p-4"
      >
        <div className="space-y-1">
          <label htmlFor="title" className="ui-label">Title</label>
          <input
            id="title" name="title" required maxLength={200}
            className="ui-control tap w-full"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="slug" className="ui-label">Address</label>
          <input
            id="slug" name="slug" maxLength={120} placeholder="derived from the title"
            className="ui-control tap w-full"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to generate one. Another company using the same address does not affect you.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="price" className="ui-label">Price</label>
          {/* Text with a decimal keypad, never type="number": the column is a
              Decimal and a number input hands back a JS float (M-06 / D-06). */}
          <input
            id="price" name="price" type="text" inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*" required defaultValue="0"
            className="ui-control tap w-full tabular-nums"
          />
        </div>

        <button
          type="submit"
          className="ui-btn ui-btn-primary tap"
        >
          {t("common.create")}
        </button>
      </form>
      </PageBody>
    </ConsoleShell>
  );
}
