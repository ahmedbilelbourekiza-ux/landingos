import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { formatPrice } from "@/lib/landing/format";
import { formatDate } from "@/lib/landing/date";
import { OrderDetailsActions, BackToOrdersButton } from "@/components/orders/order-details-actions";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { StatusWorkflowCard } from "@/components/orders/status-workflow-card";

export const metadata: Metadata = {
  title: "Order Details",
};

interface VariantSnapshot {
  name: string;
  value: string;
}

export default async function OrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const order = await db.order.findUnique({
    where: { id },
    include: {
      landingPage: {
        select: {
          id: true,
          title: true,
          slug: true,
          media: { where: { placement: "GALLERY" }, take: 1, orderBy: { displayOrder: "asc" }, select: { url: true } },
        },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
        select: { id: true, fromStatus: true, toStatus: true, createdAt: true },
      },
    },
  });

  if (!order) notFound();

  const variants: VariantSnapshot[] = JSON.parse(order.variants);
  const productPrice = order.productPrice.toNumber();
  const shippingPrice = order.shippingPrice.toNumber();
  const totalPrice = order.totalPrice.toNumber();
  const landing = order.landingPage;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="sticky top-16 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <BackToOrdersButton />
          <span className="font-mono text-sm font-semibold">{order.id.slice(-8).toUpperCase()}</span>
          <OrderStatusBadge status={order.status} />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {formatDate(order.createdAt.toISOString())}
          </span>
        </div>
        <OrderDetailsActions
          orderId={order.id}
          phone={order.phone}
          address={order.address}
          landingSlug={landing?.slug ?? null}
        />
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column: Customer + Product + Variants */}
          <div className="flex flex-col gap-6">
            {/* Customer Card */}
            <DetailCard title="Customer">
              <DetailRow label="Name" value={order.customerName} />
              <DetailRow label="Phone" value={order.phone} />
              <DetailRow label="Wilaya" value={order.wilaya} />
              <DetailRow label="Commune" value={order.baladia} />
              <DetailRow label="Address" value={order.address} />
              {order.notes && <DetailRow label="Notes" value={order.notes} />}
            </DetailCard>

            {/* Product Card */}
            <DetailCard title="Product">
              <div className="flex items-center gap-3">
                {landing?.media[0]?.url && (
                  <span className="relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
                    <img
                      src={landing.media[0].url}
                      alt={landing.title}
                      className="h-full w-full object-cover"
                    />
                  </span>
                )}
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{landing?.title ?? "Unknown product"}</span>
                  <span className="text-xs text-muted-foreground">
                    Landing: {landing?.slug ?? "—"}
                  </span>
                  <span className="text-sm font-medium">Quantity: {order.quantity}</span>
                </div>
              </div>
            </DetailCard>

            {/* Variants Card */}
            {variants.length > 0 && (
              <DetailCard title="Variants">
                <div className="flex flex-col gap-3">
                  {variants.map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{v.name}</span>
                      <span className="font-medium">{v.value}</span>
                    </div>
                  ))}
                </div>
              </DetailCard>
            )}
          </div>

          {/* Right column: Pricing + Status Workflow */}
          <div className="flex flex-col gap-6">
            {/* Pricing Card */}
            <DetailCard title="Pricing">
              <div className="flex flex-col gap-3">
                <DetailRow label="Product Price" value={formatPrice(productPrice, "DZD")} />
                <DetailRow label="Shipping Price" value={formatPrice(shippingPrice, "DZD")} />
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="text-lg font-bold tabular-nums">
                    {formatPrice(totalPrice, "DZD")}
                  </span>
                </div>
              </div>
            </DetailCard>

            {/* Status Workflow Card (replaces Timeline) */}
            <StatusWorkflowCard
              orderId={order.id}
              currentStatus={order.status}
              initialHistory={order.statusHistory.map((h) => ({
                id: h.id,
                fromStatus: h.fromStatus,
                toStatus: h.toStatus,
                createdAt: h.createdAt.toISOString(),
              }))}
            />

            {/* Timeline info (created/updated) */}
            <DetailCard title="Timeline">
              <div className="flex flex-col gap-3">
                <DetailRow label="Created" value={formatDate(order.createdAt.toISOString())} />
                <DetailRow label="Updated" value={formatDate(order.updatedAt.toISOString())} />
              </div>
            </DetailCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <header className="border-b px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
