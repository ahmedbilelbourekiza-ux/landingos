import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { withTenant } from "@landingos/db";
import { formatMoney, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { resolveStorefrontTenant, storefrontHref } from "@/lib/storefront/resolve-tenant";
import { PurchaseTracker } from "@/components/landing/tracking-scripts";
import { ThemeProvider } from "@/components/landing/theme-provider";
import { StorefrontTracking } from "@/components/landing/storefront-tracking";
import { toThemeData } from "@/lib/landing/mappers";

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

/**
 * NOINDEX, EXPLICITLY — this is the one storefront page that must never be
 * found, and it now has to say so itself.
 *
 * The storefront layout opts this whole subtree INTO indexing, which is right
 * for a shop and wrong for a customer's order: this page carries a name, a
 * wilaya and a total. "Unguessable id" is what makes it safe to serve without
 * a session; it is NOT what keeps it out of an index, because a crawler does
 * not have to guess a URL that was linked, pasted into a chat, or handed over
 * in a `Referer` header.
 *
 * `LB.14a` already refuses to let any shared cache hold this response. This is
 * the same decision one layer out, and the two belong together: a page nobody
 * may cache is a page nobody may index.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
        landingPage: {
          select: { id: true, title: true, slug: true, currency: true, theme: true },
        },
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
    // The LAST step of the checkout journey wears the theme of the landing
    // page the order came from — the customer keeps looking at the page they
    // just bought on, not at their OS's idea of this site. Without a scope,
    // next-themes' `.dark` on <html> reaches in and a dark-phone customer
    // buys on a light page and lands on a near-black confirmation (the same
    // bleed LB.26 fixed for the landing pages themselves).
    <ThemeProvider theme={toThemeData(order.landingPage?.theme ?? null)}>
      {/* LB.35 — the tenant's whole active set, deliberately NOT the ordered
          page's selection. The Purchase below is the conversion every one of
          the merchant's ad accounts is waiting for; scoping it to the pixels
          that happened to be linked to the product page would silently stop
          reporting sales to the others. */}
      <StorefrontTracking tenantId={tenant.id} />
      {/* Arabic like the rest of the storefront (the purchase form's strings
          are Arabic literals): this page was the one English screen a customer
          saw, on every single sale (M-04, storefront half). */}
      <main className="mx-auto max-w-lg px-4 py-16 text-center" data-testid="thank-you" dir="rtl">
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
        <h1 className="text-2xl font-semibold">شكراً لك، {order.customerName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          تم استلام طلبك بنجاح. سنتصل بك قريباً لتأكيده.
        </p>

        <dl className="mt-8 space-y-2 rounded-lg border border-border p-4 text-start text-sm">
          {row("رقم الطلب", <span className="font-mono text-xs" dir="ltr">{order.id}</span>)}
          {row("المنتج", order.landingPage?.title ?? "—")}
          {row("الكمية", <span className="tabular-nums">{order.quantity}</span>)}
          {row("التوصيل إلى", `${order.wilaya} · ${order.baladia}`)}
          {row("الإجمالي", <span className="tabular-nums">{formatMoney(String(order.totalPrice), locale)}</span>, true)}
        </dl>

        <Link href={storefrontHref(tenant)} className="mt-8 inline-block text-sm underline">
          مواصلة التسوق
        </Link>
      </main>
    </ThemeProvider>
  );
}
