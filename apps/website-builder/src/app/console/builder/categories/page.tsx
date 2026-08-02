import { forTenant } from "@landingos/db";

import { requireProduct } from "@/lib/console/product-page";
import { ConsoleShell } from "@/components/console/console-shell";
import { DataTable } from "@/components/console/data-table";

export const dynamic = "force-dynamic";

export default async function BuilderCategoriesScreen() {
  const { session, t } = await requireProduct("website-builder", "/console/builder/categories");

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
    <ConsoleShell session={session} productId="website-builder">
      <h1 className="text-xl font-semibold">{t("builder.nav.categories")}</h1>
      <DataTable
        testId="categories-table"
        empty={t("common.empty")}
        rows={categories}
        rowKey={(c) => c.id}
        rowAttrs={(c) => ({ "data-category-id": c.id })}
        columns={[
          {
            id: "name",
            header: t("builder.nav.categories"),
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
            header: "Status",
            cell: (c) => (
              <span data-visible={String(c.isVisible)} className="text-xs text-muted-foreground">
                {c.isVisible
                  ? t("status.landingPage.published")
                  : t("status.landingPage.draft")}
              </span>
            ),
          },
        ]}
      />
    </ConsoleShell>
  );
}
