import { can } from "@landingos/auth";
import { forTenant } from "@landingos/db";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { DataTable } from "@/components/console/data-table";
import { CategoryCreateForm } from "@/components/console/builder/category-create-form";
import { CategoryRowActions } from "@/components/console/builder/category-row-actions";

export const dynamic = "force-dynamic";

/* B3 (CAPABILITY_AUDIT): the CRUD routes existed — validated, gated,
 * suite-covered — and this screen was a read-only list, so a merchant could
 * not create, hide or delete a category at all. The write UI is gated on the
 * SAME permission the routes check (D-PM.A): no control that would 403. */

export default async function BuilderCategoriesScreen() {
  const { session, t } = await requireProduct("website-builder", "/console/builder/categories");
  const canWrite = can(session.auth!, "website-builder:pages:write");
  const errors = actionErrors(t);

  const categories = await forTenant(session.auth!.tenantId).category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      isVisible: true,
      sortOrder: true,
      _count: { select: { landingPages: true } },
    },
  });

  return (
    <>
      <PageBody>
      <PageHeader title={t("builder.nav.categories")} />
      {canWrite && (
        <CategoryCreateForm
          labels={{
            create: t("builder.categories.create"),
            name: t("builder.categories.name"),
            slug: t("builder.categories.slug"),
          }}
          errors={errors}
        />
      )}
      <DataTable
        testId="categories-table"
        empty={t("common.empty")}
        rows={categories}
        rowKey={(c) => c.id}
        rowAttrs={(c) => ({ "data-category-id": c.id })}
        columns={[
          {
            id: "name",
            header: t("builder.pages.colCategory"),
            cell: (c) => (
              <>
                <span className="font-medium">{c.name}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                  /{c.slug}
                </span>
              </>
            ),
          },
          {
            id: "pages",
            header: t("builder.nav.pages"),
            numeric: true,
            cell: (c) => c._count.landingPages,
          },
          {
            id: "visible",
            header: t("common.status"),
            cell: (c) => (
              <span data-visible={String(c.isVisible)} className="text-xs text-muted-foreground">
                {c.isVisible
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
                  cell: (c: (typeof categories)[number]) => (
                    <CategoryRowActions
                      id={c.id}
                      isVisible={c.isVisible}
                      labels={{
                        show: t("builder.categories.show"),
                        hide: t("builder.categories.hide"),
                        delete: t("builder.categories.delete"),
                        confirmDelete: t("builder.categories.confirmDelete"),
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
        <p className="text-xs text-muted-foreground">{t("builder.categories.deleteHint")}</p>
      )}
      </PageBody>
    </>
  );
}
