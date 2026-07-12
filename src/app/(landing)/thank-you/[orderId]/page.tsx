import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Phone, MapPin, Package, Truck } from "lucide-react";

import { db } from "@/lib/db";
import { formatPrice } from "@/lib/landing/format";

export const metadata: Metadata = {
  title: "تم استلام طلبك",
};

interface VariantSnapshot {
  name: string;
  value: string;
}

export default async function ThankYouPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerName: true,
      phone: true,
      wilaya: true,
      baladia: true,
      notes: true,
      quantity: true,
      variants: true,
      productPrice: true,
      shippingPrice: true,
      totalPrice: true,
      status: true,
      createdAt: true,
      landingPage: {
        select: { slug: true },
      },
    },
  });

  if (!order) notFound();

  const landing = order.landingPage;
  const variants: VariantSnapshot[] = JSON.parse(order.variants);
  const currency = "DZD"; // COD orders are always in DZD
  const productPrice = order.productPrice.toNumber();
  const shippingPrice = order.shippingPrice.toNumber();
  const totalPrice = order.totalPrice.toNumber();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Success header */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="size-9 text-emerald-600" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" dir="rtl">
            تم استلام طلبك بنجاح
          </h1>
        </div>

        {/* Order details card */}
        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-sm" dir="rtl">
          <div className="flex flex-col gap-4">
            {/* Order number */}
            <div className="flex items-center justify-between border-b pb-3">
              <span className="text-sm text-muted-foreground">رقم الطلب</span>
              <span className="font-mono text-sm font-semibold">
                {order.id.slice(-8).toUpperCase()}
              </span>
            </div>

            {/* Customer name */}
            <DetailRow label="اسم العميل" value={order.customerName} />

            {/* Phone */}
            <DetailRow label="رقم الهاتف" value={order.phone} icon={<Phone className="size-4" />} />

            {/* Wilaya */}
            <DetailRow label="الولاية" value={order.wilaya} icon={<MapPin className="size-4" />} />

            {/* Baladia */}
            <DetailRow label="البلدية" value={order.baladia} />

            {/* Variants */}
            {variants.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {variants.map((v, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{v.name}</span>
                    <span className="font-medium">{v.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Quantity */}
            <DetailRow label="الكمية" value={String(order.quantity)} icon={<Package className="size-4" />} />

            {/* Price breakdown */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">سعر المنتج</span>
                <span className="tabular-nums">{formatPrice(productPrice, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">سعر التوصيل</span>
                <span className="tabular-nums">{formatPrice(shippingPrice, currency)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t pt-1 text-base font-bold">
                <span>الإجمالي</span>
                <span className="tabular-nums">{formatPrice(totalPrice, currency)}</span>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">حالة الطلب</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700">
                <span className="size-1.5 rounded-full bg-amber-500" />
                {order.status}
              </span>
            </div>
          </div>
        </div>

        {/* Message */}
        <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-center" dir="rtl">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-foreground">
            <Truck className="size-4 text-primary" />
            سيتم التواصل معك خلال وقت قصير لتأكيد الطلب
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            يرجى إبقاء هاتفك متاحًا
          </p>
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row" dir="rtl">
          {landing?.slug && (
            <a
              href={`/l/${landing.slug}`}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-foreground px-6 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              طلب مرة أخرى
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">
        {icon}
        {value}
      </span>
    </div>
  );
}
