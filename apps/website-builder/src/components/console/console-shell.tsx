import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { withTenant } from "@landingos/db";
import { productRegistry } from "@landingos/product-registry";
import type { ConsoleSession } from "@/lib/console/session";
import { unreadCount } from "@/lib/platform/notifications";
import { readNotifyPrefs, NOTIFY_DEFAULTS } from "@/lib/platform/notify-prefs";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

import { ProductSwitcher } from "./product-switcher";
import { TenantSwitcher } from "./tenant-switcher";
import { LocaleSwitcher } from "./locale-switcher";
import { ConsoleNav } from "./console-nav";
import { ConsoleDrawer } from "./console-sidebar";
import { SignOutButton } from "./sign-out-button";
import { NotificationProvider } from "./notification-provider";
import { ThemeSwitcher } from "./theme-switcher";
import { ActionFeedback } from "./action-feedback";
import { NavIcon } from "./ui/icon";
import { pageContainer } from "./ui/styles";

/* =============================================================================
 * The console shell — one frame for every product.
 *
 * Nothing here names a product. The switcher lists whatever the tenant is
 * entitled to and the person is permitted to reach; the navigation is whatever
 * the active product's manifest declares, in whatever groups it declares. Adding
 * a tenth product changes this file not at all, which is the entire claim the
 * platform makes about itself.
 *
 * Platform surfaces — company, team, billing, settings — live in the shell
 * rather than inside a product, so a tenant with three products still has ONE
 * of each rather than three.
 *
 * Layout uses CSS logical properties throughout (border-inline-end, ps-*, ms-*)
 * so Arabic RTL and French/English LTR share one implementation. Direction is
 * declared once on <html dir> by the root layout (R-10).
 *
 * ---------------------------------------------------------------------------
 * UI.10 — WHAT CHANGED IN THE MODERNISATION, AND WHY
 *
 *  - **The rail is fixed and the drawer exists.** The sidebar was
 *    `hidden … md:flex` with nothing replacing it, so below 768px there was no
 *    navigation at all. `ConsoleSidebar` renders the same tree twice.
 *  - **The header is sticky and says where you are.** It was 56px carrying a
 *    tenant switcher and a name; every page's `<h1>` lived inside the scroll
 *    area and was gone within one screen on the order detail.
 *  - **The theme can be chosen.** See `theme-switcher.tsx`.
 *  - **`<main>` has a container and an id**, so lines stop running to 180
 *    characters on a wide monitor and the skip link has somewhere to land.
 *
 * None of it changes what renders. Every permission gate, every registry read
 * and every string is the one that was here before.
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
  /* AND IT NEVER FAILS THE PAGE. This is one extra bound read on every console
     render — the shell has no access to the page's own binding, so it opens its
     own — and a badge is not worth a 500 over. A database blip already surfaces
     here as a 500 from a screen rather than as a test error (see PROJECT_STATE's
     known limitations), and adding a second chance to hit it without a fallback
     would make every console page strictly more fragile than before LP.7. */
  let unread = 0;
  /* LP.11 — read beside the count, on the same connection, under the same
     fallback. The DEFAULTS are what a failed read produces, which is the safe
     direction: an operator hears their alerts rather than sitting in silence
     because a settings row could not be fetched. */
  let notifyPrefs = NOTIFY_DEFAULTS;
  if (session.auth) {
    try {
      const read = await withTenant(session.auth.tenantId, async (db) => ({
        unread: await unreadCount(db, session.user.id),
        prefs: await readNotifyPrefs(db, session.user.id),
      }));
      unread = read.unread;
      notifyPrefs = read.prefs;
    } catch (error) {
      console.error("[console] could not read the unread count", error);
    }
  }

  /* Product id → translated name, resolved HERE so the provider holds no
     registry and no catalogue. A notification is cross-product by construction
     (one feed per person, every product they use), so the toast has to be able
     to say which one raised it. */
  const productNames = Object.fromEntries(
    productRegistry.list().map((p) => [p.id, t(p.nameKey)]),
  );

  /* The navigation tree, rendered once on the server and handed to the frame,
     which draws it in the rail and in the drawer. Two calls would be two
     registry reads and two permission filters that could disagree. */
  const navigation = (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4">
        <Link
          href="/console"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"
          >
            <NavIcon name={product?.icon ?? "briefcase"} className="size-3.5" />
          </span>
          {siteConfig.name}
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

      <nav
        aria-label={product ? t(product.nameKey) : siteConfig.name}
        className="flex-1 overflow-y-auto p-3"
      >
        <ConsoleNav
          basePath={product ? productRegistry.hrefFor(product.id)! : ""}
          items={nav.map((i) => ({
            id: i.id,
            href: `${productRegistry.hrefFor(product!.id)}${i.path ? `/${i.path}` : ""}`,
            title: t(i.titleKey),
            icon: i.icon,
            // Translated HERE, not in the client component: the group is an
            // i18n key on the manifest, and `ConsoleNav` holds no catalogue for
            // the same reason it holds no registry.
            group: i.group ? t(i.group) : undefined,
          }))}
        />
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-sidebar-border p-3">
        <Link
          href="/console/settings"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground",
            "transition-colors duration-(--duration-fast) hover:bg-sidebar-accent/60 hover:text-foreground tap",
          )}
        >
          <NavIcon name="settings" className="size-4 shrink-0 text-muted-foreground/70" />
          {t("common.settings")}
        </Link>
        <SignOutButton label={t("common.signOut")} />
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* First in the DOM and invisible until focused. Keyboard and screen
          reader users were traversing the tenant switcher, fifteen nav items,
          settings and sign out before reaching content — on every navigation. */}
      <a href="#console-main" className="skip-link">
        {t("common.skipToContent")}
      </a>

      {/* The permanent rail. Fixed rather than a flex child so it scrolls its
          own overflow: a 15-item menu and a 3,600px order list must not share
          one scrollbar. */}
      <aside
        data-testid="console-sidebar"
        className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-sidebar-border bg-sidebar md:flex"
      >
        {navigation}
      </aside>

      {/* `ms-64` from md up rather than a flex row: the rail is `fixed`, so it
          scrolls its own overflow independently of the page. A 15-item menu and
          a 3,600px order list must not share one scrollbar. */}
      <div className="flex min-h-screen min-w-0 flex-col md:ms-64">
        <header
          className={cn(
            "sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border",
            // Translucent with a blur, so the content scrolling beneath reads as
            // continuing rather than as being cut off — and opaque enough that
            // a table's sticky header sliding under it stays legible.
            "bg-background/85 px-3 backdrop-blur-md sm:px-4",
          )}
        >
          {/* The drawer's trigger and the drawer share one owner, so the
              component that holds the open state renders both — which is why
              it sits in the header rather than beside the rail. */}
          <ConsoleDrawer
            labels={{
              open: t("common.openMenu"),
              close: t("common.closeMenu"),
              navigation: t("common.navigation"),
            }}
          >
            {navigation}
          </ConsoleDrawer>
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
          <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* ONE subscription per session, not per screen: this shell is on
                every console page, and a provider per screen would open N
                streams per tab — each of which is a polling query. */}
            {session.auth && (
              <NotificationProvider
                unread={unread}
                prefs={notifyPrefs}
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
            <ThemeSwitcher
              labels={{
                theme: t("common.theme"),
                light: t("common.themeLight"),
                dark: t("common.themeDark"),
                system: t("common.themeSystem"),
              }}
            />
            {/* Withheld below `sm`, and the measurement is why: at 375px the
                header cluster came to 319px beside a menu button and a company
                name, and the page scrolled sideways by 16px. Language is set
                once and has a permanent home on the profile screen; the theme
                has no other control anywhere, so it is the one that stays.
                Found by measuring the running page at 375px, not by reading. */}
            <div className="hidden sm:block">
              <LocaleSwitcher label={t("common.language")} apply={t("common.apply")} />
            </div>
            {/* The name is the least urgent thing in the header and the first
                to go when the row runs out of width. It is not a control. */}
            <span
              className="hidden max-w-40 truncate text-sm text-muted-foreground lg:inline"
              title={session.user.name ?? undefined}
            >
              {session.user.name}
            </span>
          </div>
        </header>

        <main id="console-main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className={pageContainer}>{children}</div>
        </main>
      </div>

      {/* UI.24 — one listener for every write panel in the console. Mounted in
          the shell for the same reason the notification provider is: there is
          one of it per session, not one per screen. */}
      <ActionFeedback label={t("common.saved")} />
    </div>
  );
}
