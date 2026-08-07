import { notFound } from "next/navigation";
import Link from "next/link";

import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { resolveStorefrontTenant, storefrontHref } from "@/lib/storefront/resolve-tenant";
import { PurchaseTracker } from "@/components/landing/tracking-scripts";

export const dynamic = "force-dynamic";

/* =============================================================================
 * Post-checkout confirmation.
 *
 * Shows only what the person who just ordered already knows: what they bought,
 * how much it cost, and where it is going. An order id from another tenant is
 * unreachable even if valid, because the query is bound.
 *
 * Safe to show without a session because the id is a cuid and therefore not
 * guessable. It deliberately does NOT echo the phone number or the full street
 * address back onto a page that might be left open or shared.
 * ========================================================================== */

export default async function ThankYouPage({
  params,
}: {
  params: Promise<{ tenant: string; orderId: string }>;
}) {
  const { tenant: tenantSlug, orderId } = await params;
  const tenant = await resolveStorefrontTenant(tenantSlug);
  if (!tenant) notFound();

  const locale = isLocale(tenant.locale) ? tenant.locale : DEFAULT_LOCALE;

  const order = await withTenant(tenant.id, (db) =>
    (db as any).salesOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerName: true,
        wilaya: true,
        baladia: true,
        quantity: true,
        totalPrice: true,
        createdAt: true,
        landingPage: { select: { id: true, title: true, slug: true, currency: true } },
      },
    }),
  );

  if (!order) notFound();

  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className={`flex justify-between gap-4${strong ? " border-t border-border pt-2 font-medium" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center" data-testid="thank-you">
      {/* The browser-side Purchase, keyed on the ORDER ID — the same dedup id
          the server-side conversion event carries, so ad platforms count this
          sale once however many of the two got through (LB.5). */}
      <PurchaseTracker
        orderId={order.id}
        value={Number(order.totalPrice)}
        currency={order.landingPage?.currency ?? tenant.currency}
        contentId={order.landingPage?.id}
        contentName={order.landingPage?.title}
        quantity={order.quantity}
      />
      <h1 className="text-2xl font-semibold">Thank you, {order.customerName}.</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your order has been received. We will call to confirm it shortly.
      </p>

      <dl className="mt-8 space-y-2 rounded-lg border border-border p-4 text-start text-sm">
        {row("Order", <span className="font-mono text-xs" dir="ltr">{order.id}</span>)}
        {row("Product", order.landingPage?.title ?? "—")}
        {row("Quantity", <span className="tabular-nums">{order.quantity}</span>)}
        {row("Delivering to", `${order.wilaya} · ${order.baladia}`)}
        {row("Total", <span className="tabular-nums">{formatMoney(String(order.totalPrice), locale)}</span>, true)}
      </dl>

      <Link href={storefrontHref(tenant)} className="mt-8 inline-block text-sm underline">
        Continue shopping
      </Link>
    </main>
  );
}
