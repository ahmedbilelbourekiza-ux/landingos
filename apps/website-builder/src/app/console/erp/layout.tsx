import { notFound } from "next/navigation";

import { getConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";
import { FINANCE_NAV_IDS } from "@/lib/erp/settings";
import { financeEnabledFor } from "@/lib/erp/finance-module";

/* UI.6 — the shell belongs to the SEGMENT, not to each page. With every page
 * rendering its own ConsoleShell, a navigation could show nothing until the
 * whole next screen had rendered server-side; with the shell here, the frame
 * stays mounted across navigation and the pending skeleton fills only the
 * content area (see content-pending.tsx — deliberately NOT `loading.tsx`,
 * whose streaming would turn every screen-level notFound() into a 200).
 *
 * Auth still belongs to the PAGES. Every screen under this segment calls
 * requireConsoleSession itself and owns its redirect (with its own `next`
 * target) — this layout only decides whether it has a session to draw the
 * shell with. Without one it passes children through bare and lets the page's
 * redirect fire; nothing paints either way.
 *
 * The ENTITLEMENT gate lives here as well as in the pages, for three reasons
 * (probed, not assumed: console/not-found.tsx renders ABOVE this layout, so
 * even a page-level notFound() ships a shell-free 404 today). First, economy:
 * without it, every probe of an unbought product URL still pays the shell's
 * own reads — session products, unread count, prefs — before the page
 * refuses. Second, the decision belongs where the frame is drawn: the
 * component that renders a product's chrome refuses to render it for a
 * tenant that never bought it. Third, the boundary position is one
 * innocent-looking `not-found.tsx` inside this segment away from moving
 * BELOW the shell — the gate (and the console-shell test that pins the
 * chrome-free 404 body) makes that change safe to make. */

export default async function ErpConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getConsoleSession();
  if (!session) return <>{children}</>;
  if (!session.products.some((p) => p.id === "erp")) notFound();

  /* LB.18 — the ERP decides which of its OWN items are switched off, and hands
   * the shell ids. The shell may not learn that a "finance module" exists; that
   * is the manifest contract, and it is why this read lives here rather than
   * three files further in. One extra indexed read per ERP render, on the
   * segment layout that already loads the session — and it fails open, so a
   * database blip shows the module rather than 500ing the whole product. */
  const showFinance = await financeEnabledFor(session.auth!.tenantId);

  return (
    <ConsoleShell
      session={session}
      productId="erp"
      hiddenNavIds={showFinance ? undefined : FINANCE_NAV_IDS}
    >
      {children}
    </ConsoleShell>
  );
}
