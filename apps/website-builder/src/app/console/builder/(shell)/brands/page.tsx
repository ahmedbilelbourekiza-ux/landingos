import { can } from "@landingos/auth";
import { forTenant } from "@landingos/db";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { BrandCreateForm } from "@/components/console/builder/brand-create-form";
import { BrandRowActions } from "@/components/console/builder/brand-row-actions";

export const dynamic = "force-dynamic";

/* LB.36 — the brands screen: the categories screen's exact shape. A brand is
 * a PUBLIC identity a page sells under; linking it to categories is data the
 * row actions edit, and deleting one un-brands its pages (SetNull) rather
 * than touching them. */

export default async function BuilderBrandsScreen() {
  const { session, t } = await requireProduct("website-builder", "/console/builder/brands");
  const canWrite = can(session.auth!, "website-builder:pages:write");
  const errors = actionErrors(t);

  const db = forTenant(session.auth!.tenantId);
  const [brands, categories] = await Promise.all([
    (db as any).brand.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        isVisible: true,
        categories: { select: { category: { select: { id: true, name: true } } } },
        _count: { select: { landingPages: true } },
      },
    }),
    db.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <PageBody>
      <PageHeader title={t("builder.nav.brands")} description={t("builder.brands.subtitle")} />
      {canWrite && (
        <BrandCreateForm
          categories={categories}
          labels={{
            create: t("builder.brands.create"),
            name: t("builder.brands.name"),
            slug: t("builder.brands.slug"),
            categories: t("builder.brands.categories"),
          }}
          errors={errors}
        />
      )}
      <DataTable
        testId="brands-table"
        empty={t("builder.brands.empty")}
        rows={brands}
        rowKey={(b: any) => b.id}
        rowAttrs={(b: any) => ({ "data-brand-id": b.id })}
        columns={[
          {
            id: "name",
            header: t("builder.brands.brand"),
            cell: (b: any) => (
              <>
                <span className="font-medium">{b.name}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                  /{b.slug}
                </span>
              </>
            ),
          },
          {
            id: "categories",
            header: t("builder.brands.categories"),
            cell: (b: any) => (
              <span className="text-xs text-muted-foreground">
                {b.categories.length
                  ? b.categories.map((l: any) => l.category.name).join(" · ")
                  : "—"}
              </span>
            ),
          },
          {
            id: "pages",
            header: t("builder.nav.pages"),
            numeric: true,
            cell: (b: any) => b._count.landingPages,
          },
          {
            id: "visible",
            header: t("common.status"),
            cell: (b: any) => (
              <span data-visible={String(b.isVisible)} className="text-xs text-muted-foreground">
                {b.isVisible
                  ? t("status.landingPage.published")
                  : t("status.landingPage.draft")}
              </span>
            ),
          },
          ...(canWrite
            ? [
                {
                  id: "actions",
                  header: "",
                  cell: (b: any) => (
                    <BrandRowActions
                      id={b.id}
                      isVisible={b.isVisible}
                      categoryIds={b.categories.map((l: any) => l.category.id)}
                      categories={categories}
                      labels={{
                        show: t("builder.categories.show"),
                        hide: t("builder.categories.hide"),
                        delete: t("builder.categories.delete"),
                        confirmDelete: t("builder.categories.confirmDelete"),
                        editCategories: t("builder.brands.editCategories"),
                        save: t("common.save"),
                      }}
                      errors={errors}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      {canWrite && (
        <p className="text-xs text-muted-foreground">{t("builder.brands.deleteHint")}</p>
      )}
      </PageBody>
    </>
  );
}
