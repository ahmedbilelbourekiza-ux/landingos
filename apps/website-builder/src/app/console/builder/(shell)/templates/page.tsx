import { Palette } from "lucide-react";

import { forTenant } from "@landingos/db";

import { requireProduct } from "@/lib/console/product-page";
import { PageHeader, PageBody, EmptyState } from "@/components/console/ui/primitives";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Templates — the theme gallery (LB.4, S-02).
 *
 * The manifest has declared this nav item since Phase 4 and no screen existed:
 * every builder tenant saw a menu entry that answered 404 — LP.17's defect
 * shape, on this product. The themes themselves have had a read API and rows
 * since the port; this is their first screen.
 *
 * Read-only by design for now: themes are chosen PER PAGE in the editor's
 * General section, and this gallery shows what is available and where each is
 * used. Authoring custom themes is roadmap (M-19's registry of real layouts).
 * ========================================================================== */

export default async function BuilderTemplatesScreen() {
  const { session, t } = await requireProduct("website-builder", "/console/builder/templates");

  const themes = await forTenant(session.auth!.tenantId).landingTheme.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      primary: true,
      primaryForeground: true,
      accent: true,
      background: true,
      card: true,
      text: true,
      isBuiltIn: true,
      _count: { select: { landingPages: true } },
    },
  });

  return (
    <>
      <PageBody>
        <PageHeader
          title={t("builder.nav.templates")}
          description={t("builder.templates.hint")}
        />

        {themes.length === 0 ? (
          /* One muted line saying "No data" told a new merchant nothing about
             what a theme IS or where one is chosen. The empty state explains
             both — and does not offer a create control, because authoring
             themes is genuinely not a capability yet (M-19). */
          <EmptyState
            testId="themes-empty"
            icon={<Palette className="size-5" />}
            title={t("builder.templates.empty")}
            description={t("builder.templates.emptyHint")}
          />
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="themes-gallery">
            {themes.map((theme) => (
              <li
                key={theme.id}
                data-theme-id={theme.id}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                {/* A live swatch of the theme's own tokens — a colour list
                    nobody can read is not a preview. */}
                <div style={{ backgroundColor: theme.background }} className="p-4">
                  <div
                    style={{ backgroundColor: theme.card, color: theme.text }}
                    className="rounded-md p-3 shadow-sm"
                  >
                    <span className="block text-sm font-medium">{theme.name}</span>
                    <span
                      style={{ backgroundColor: theme.primary, color: theme.primaryForeground }}
                      className="mt-2 inline-block rounded px-2 py-1 text-xs"
                    >
                      {t("builder.templates.buttonSample")}
                    </span>
                    <span
                      style={{ backgroundColor: theme.accent }}
                      className="ms-1.5 mt-2 inline-block size-4 rounded-full align-middle"
                      aria-hidden
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
                  <span>
                    {theme.isBuiltIn ? t("builder.templates.builtIn") : t("builder.templates.custom")}
                  </span>
                  <span className="tabular-nums">
                    {t("builder.templates.pagesUsing", { count: theme._count.landingPages })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
