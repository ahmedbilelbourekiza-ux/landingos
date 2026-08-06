import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { withTenant } from "@landingos/db";
import { productRegistry } from "@landingos/product-registry";
import type { ConsoleSession } from "@/lib/console/session";
import { unreadCount } from "@/lib/platform/notifications";

import { ProductSwitcher } from "./product-switcher";
import { TenantSwitcher } from "./tenant-switcher";
import { LocaleSwitcher } from "./locale-switcher";
import { ConsoleNav } from "./console-nav";
import { SignOutButton } from "./sign-out-button";
import { NotificationProvider } from "./notification-provider";

/* =============================================================================
 * The console shell — one frame for every product.
 *
 * Nothing here names a product. The switcher lists whatever the tenant is
 * entitled to and the person is permitted to reach; the navigation is whatever
 * the active product's manifest declares. Adding a tenth product changes this
 * file not at all, which is the entire claim the platform makes about itself.
 *
 * Platform surfaces — company, team, billing, settings — live in the shell
 * rather than inside a product, so a tenant with three products still has ONE
 * of each rather than three.
 *
 * Layout uses CSS logical properties throughout (border-inline-end, ps-*, ms-*)
 * so Arabic RTL and French/English LTR share one implementation. Direction is
 * declared once on <html dir> by the root layout (R-10).
 * ========================================================================== */

export async function ConsoleShell({
  session,
  productId,
  children,
}: {
  session: ConsoleSession;
  /** Which product's navigation to show. Null on platform-level pages. */
  productId: string | null;
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const product = productId ? productRegistry.get(productId) : undefined;
  const nav = product ? productRegistry.navFor(product.id, session.permissions) : [];

  /* LP.7. THE BADGE COUNT IS THE SERVER'S, re-read on every render of the shell
     — which is every console page, and which the provider's debounced
     `router.refresh()` re-triggers when anything arrives. An in-memory counter
     in the browser is wrong the moment a second tab marks something read, wrong
     after a reconnect that replays, and wrong for anything raised while the tab
     was closed. That is the defect the M-16 audit found in the ERP.

     Skipped entirely without an active tenant: `Notification` is RLS-scoped and
     there is nothing to bind. A person still choosing a company has no feed. */
  const unread = session.auth
    ? await withTenant(session.auth.tenantId, (db) => unreadCount(db, session.user.id))
    : 0;

  /* Product id → translated name, resolved HERE so the provider holds no
     registry and no catalogue. A notification is cross-product by construction
     (one feed per person, every product they use), so the toast has to be able
     to say which one raised it. */
  const productNames = Object.fromEntries(
    productRegistry.list().map((p) => [p.id, t(p.nameKey)]),
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <Link href="/console" className="text-sm font-semibold tracking-tight">
            LandingOS
          </Link>
        </div>

        {/* The app switcher. Only products this person can actually open. */}
        <div className="border-b border-sidebar-border p-3">
          <ProductSwitcher
            products={session.products.map((p) => ({
              id: p.id,
              // The console prefix comes from the registry, so moving the
              // console is one constant rather than a search-and-replace.
              basePath: productRegistry.hrefFor(p.id) ?? p.basePath,
              name: t(p.nameKey),
              icon: p.icon,
            }))}
            activeId={productId}
          />
        </div>

        <nav aria-label={product ? t(product.nameKey) : "LandingOS"} className="flex-1 overflow-y-auto p-3">
          <ConsoleNav
            basePath={product ? productRegistry.hrefFor(product.id)! : ""}
            items={nav.map((i) => ({
              id: i.id,
              href: `${productRegistry.hrefFor(product!.id)}${i.path ? `/${i.path}` : ""}`,
              title: t(i.titleKey),
              icon: i.icon,
            }))}
          />
        </nav>

        <div className="space-y-1 border-t border-sidebar-border p-3">
          <Link
            href="/console/settings"
            className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t("common.settings")}
          </Link>
          <SignOutButton label={t("common.signOut")} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
          <TenantSwitcher
            tenants={session.memberships.map((m) => ({
              id: m.tenantId,
              name: m.tenantName,
              slug: m.tenantSlug,
              role: m.role,
            }))}
            activeId={session.tenant?.id ?? null}
            label={t("common.switchTenant")}
          />
          <div className="flex items-center gap-2">
            {/* ONE subscription per session, not per screen: this shell is on
                every console page, and a provider per screen would open N
                streams per tab — each of which is a polling query. */}
            {session.auth && (
              <NotificationProvider
                unread={unread}
                productNames={productNames}
                strings={{
                  title: t("common.notifications"),
                  open: t("notifications.open"),
                  close: t("common.cancel"),
                  empty: t("notifications.empty"),
                  markAllRead: t("notifications.markAllRead"),
                  unreadLabel: t("notifications.unread"),
                  live: t("notifications.live"),
                  reconnecting: t("notifications.reconnecting"),
                  loading: t("common.loading"),
                }}
              />
            )}
            <LocaleSwitcher label={t("common.language")} />
            <span className="text-sm text-muted-foreground">{session.user.name}</span>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
