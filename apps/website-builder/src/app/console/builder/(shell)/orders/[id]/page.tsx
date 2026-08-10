import { notFound } from "next/navigation";
import Link from "next/link";

import { forTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import {
  PageHeader, PageBody, Section, DescriptionList,
} from "@/components/console/ui/primitives";
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

  return (
    <>
      <PageBody>
        <PageHeader
          title={order.customerName}
          breadcrumb={[
            { label: t("builder.nav.orders"), href: "/console/builder/orders" },
            { label: order.customerName },
          ]}
          description={
            <span className="font-mono text-xs" dir="ltr">
              {order.id}
            </span>
          }
          meta={
            <span
              data-status={order.status}
              className="rounded-full border px-3 py-1 text-sm font-medium"
              style={toneVars(status.tone)}
            >
              {t(status.labelKey)}
            </span>
          }
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("builder.orders.colCustomer")} testId="order-details">
            <DescriptionList
              columns={2}
              items={[
                {
                  label: t("builder.orders.detailPhone"),
                  value: <span className="font-mono">{order.phone}</span>,
                  ltr: true,
                },
                {
                  label: t("builder.orders.colDestination"),
                  value: `${order.wilaya} · ${order.baladia}`,
                },
                { label: t("builder.orders.detailAddress"), value: order.address },
                {
                  label: t("builder.orders.detailPage"),
                  value: order.landingPage ? (
                    <Link
                      href={`/console/builder/pages/${order.landingPage.id}/edit`}
                      className="underline underline-offset-2"
                    >
                      {order.landingPage.title}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                ...(variants.length
                  ? [
                      {
                        label: t("builder.orders.detailOptions"),
                        value: variants.map((v) => `${v.name}: ${v.value}`).join(", "),
                      },
                    ]
                  : []),
                {
                  label: t("builder.orders.detailQuantity"),
                  value: <span className="tabular-nums">{order.quantity}</span>,
                  ltr: true,
                },
                {
                  label: t("builder.orders.detailTotal"),
                  value: (
                    <span className="tabular-nums font-medium">
                      {formatMoney(String(order.totalPrice), locale)}
                    </span>
                  ),
                  ltr: true,
                },
                ...(order.notes
                  ? [{ label: t("builder.orders.detailNotes"), value: order.notes }]
                  : []),
              ]}
            />
          </Section>

          <Section title={t("builder.orders.history")}>
            <ol className="space-y-2" data-testid="order-history">
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
              // that the API would refuse is worse than offering none. The
              // `data-final-state` hook is what the contract suite asserts —
              // the sentence itself is translated and cannot be matched.
              <p
                data-final-state={order.status}
                className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground"
              >
                {t("builder.orders.finalState")}
              </p>
            ) : null}
          </Section>
        </div>
      </PageBody>
    </>
  );
}
