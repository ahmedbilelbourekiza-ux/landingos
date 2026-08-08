import { notFound } from "next/navigation";
import Link from "next/link";

import { forTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageBody } from "@/components/console/ui/primitives";
import { OrderStatusActions } from "@/components/console/builder/order-status-actions";

export const dynamic = "force-dynamic";

/* The lifecycle controls call PATCH /api/builder/orders/[id]/status through
 * OrderStatusActions — ONE write path (D-06.1). The server action that used to
 * live here re-declared the state machine, checked no permission, and fired no
 * webhook, so a status changed through this screen never reached a subscribed
 * CRM (LB.10). */

/** Mirrors the API route exactly. Both terminal states are terminal. */
const VALID_TRANSITIONS: Record<string, string[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, locale: raw, t } = await requireProduct(
    "website-builder",
    `/console/builder/orders/${id}`,
  );
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const order = await forTenant(session.auth!.tenantId).salesOrder.findUnique({
    where: { id },
    include: {
      landingPage: { select: { id: true, title: true, slug: true } },
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  });

  // Another tenant's id does not resolve under the binding.
  if (!order) notFound();

  const status = resolveStatus("salesOrder", order.status);
  // Offered only to somebody the API would accept the write from (D-06.2),
  // decided by the same predicate the route checks.
  const mayAdvance = can(session.auth!, "website-builder:orders:write");
  const next = mayAdvance ? VALID_TRANSITIONS[order.status] ?? [] : [];
  const variants = Array.isArray(order.variants) ? (order.variants as any[]) : [];

  const field = (label: string, value: React.ReactNode) => (
    <div className="border-t border-border py-2 first:border-t-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );

  return (
    <ConsoleShell session={session} productId="website-builder">
      <PageBody>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{order.customerName}</h1>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{order.id}</p>
        </div>
        <span
          data-status={order.status}
          className="rounded-full border px-3 py-1 text-sm"
          style={toneVars(status.tone)}
        >
          {t(status.labelKey)}
        </span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4" data-testid="order-details">
          <dl>
            {field("Phone", <span dir="ltr" className="font-mono">{order.phone}</span>)}
            {field("Destination", `${order.wilaya} · ${order.baladia}`)}
            {field("Address", order.address)}
            {field(
              t("builder.nav.pages"),
              order.landingPage ? (
                <Link href={`/console/builder/pages/${order.landingPage.id}/edit`} className="underline">
                  {order.landingPage.title}
                </Link>
              ) : "—",
            )}
            {variants.length
              ? field("Options", variants.map((v) => `${v.name}: ${v.value}`).join(", "))
              : null}
            {field("Quantity", <span className="tabular-nums">{order.quantity}</span>)}
            {field(
              "Total",
              <span className="tabular-nums font-medium">
                {formatMoney(String(order.totalPrice), locale)}
              </span>,
            )}
            {order.notes ? field("Notes", order.notes) : null}
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold tracking-tight">History</h2>
          <ol className="mt-3 space-y-2" data-testid="order-history">
            {order.statusHistory.map((h: any) => {
              const s = resolveStatus("salesOrder", h.toStatus);
              return (
                <li key={h.id} className="flex items-center gap-2 text-sm">
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs"
                    style={toneVars(s.tone)}
                  >
                    {t(s.labelKey)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(h.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </li>
              );
            })}
            {order.statusHistory.length === 0 ? (
              <li className="text-sm text-muted-foreground">{t("common.empty")}</li>
            ) : null}
          </ol>

          {next.length > 0 ? (
            <OrderStatusActions
              orderId={order.id}
              transitions={next.map((s) => ({
                toStatus: s,
                label: t(resolveStatus("salesOrder", s).labelKey),
              }))}
              errors={actionErrors(t)}
            />
          ) : mayAdvance ? (
            // A delivered or cancelled order is finished. Offering a control
            // that the API would refuse is worse than offering none.
            <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
              This order has reached a final state.
            </p>
          ) : null}
        </section>
      </div>
      </PageBody>
    </ConsoleShell>
  );
}
