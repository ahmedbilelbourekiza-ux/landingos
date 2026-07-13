"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Minus, Plus, ShieldCheck, Truck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";
import { useOrderTotals, useUnitPrice } from "@/lib/landing/store";

const purchaseSchema = z.object({
  fullName: z.string().min(2, "يرجى إدخال الاسم الكامل"),
  phone: z.string().min(6, "يرجى إدخال رقم هاتف صحيح"),
  notes: z.string().optional(),
});

type PurchaseFormValues = z.infer<typeof purchaseSchema>;

interface WilayaOption {
  id: number;
  code: string;
  name: string;
  nameAr: string | null;
  baladias: { id: number; name: string; nameAr: string | null }[];
}

function QuantityStepper({ store }: { store: LandingOrderStore }) {
  const quantity = store((s) => s.quantity);
  const setQuantity = store((s) => s.setQuantity);
  return (
    <div>
      <Label className="mb-2">الكمية</Label>
      <div className="inline-flex items-center rounded-lg border">
        <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(quantity - 1)}
          className="grid size-10 place-items-center rounded-l-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Minus className="size-4" />
        </button>
        <span className="w-12 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-label={`Quantity ${quantity}`}>
          {quantity}
        </span>
        <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)}
          className="grid size-10 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function PurchaseForm({
  store,
  landingId,
  buttonText,
  currency,
}: {
  store: LandingOrderStore;
  landingId: string;
  buttonText: string;
  currency: string;
}) {
  const router = useRouter();
  const { subtotal } = useOrderTotals(store);
  const unitPrice = useUnitPrice(store);
  const quantity = store((s) => s.quantity);

  const [wilayas, setWilayas] = React.useState<WilayaOption[]>([]);
  const [selectedWilaya, setSelectedWilaya] = React.useState<number | "">("");
  const [selectedBaladia, setSelectedBaladia] = React.useState<number | "">("");
  const [deliveryPrices, setDeliveryPrices] = React.useState<Record<number, number>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    mode: "onBlur",
  });

  // Load wilayas + global delivery prices on mount
  React.useEffect(() => {
    Promise.all([
      fetch("/api/wilayas").then((r) => r.json()),
      fetch("/api/settings/delivery-prices").then((r) => r.json()),
    ]).then(([wJson, pJson]) => {
      if (wJson.success) setWilayas(wJson.data);
      if (pJson.success) {
        const map: Record<number, number> = {};
        for (const p of pJson.data) {
          if (p.homePrice !== null) map[p.wilayaId ?? p.id] = p.homePrice;
        }
        setDeliveryPrices(map);
      }
    });
  }, []);

  const selectedWilayaData = wilayas.find((w) => w.id === Number(selectedWilaya));
  const shipping = deliveryPrices[Number(selectedWilaya)] ?? null;
  const grandTotal = subtotal + (shipping ?? 0);

  const onSubmit = handleSubmit(async (values) => {
    if (submitting) return;
    if (!selectedWilaya || !selectedBaladia) {
      setSubmitError("يرجى اختيار الولاية والبلدية");
      return;
    }
    if (shipping === null) {
      setSubmitError("التوصيل غير متاح للولاية المختارة");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const state = store.getState();
      const variantSnapshot = state.groups.map((g) => ({
        name: g.name,
        value: state.selected[g.name] ?? g.options[0]?.value ?? "",
      }));

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          landingId,
          customerName: values.fullName,
          phone: values.phone,
          wilayaId: Number(selectedWilaya),
          baladiaId: Number(selectedBaladia),
          notes: values.notes || undefined,
          quantity: state.quantity,
          variants: variantSnapshot,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setSubmitError(json.error?.message || "فشل إرسال الطلب");
        setSubmitting(false);
        return;
      }
      router.push(`/thank-you/${json.data.orderId}`);
    } catch {
      setSubmitError("خطأ في الشبكة — يرجى المحاولة مرة أخرى");
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الاسم الكامل" error={errors.fullName?.message}>
          <Input id="fullName" dir="auto" placeholder="أدخل اسمك الكامل" autoComplete="name" aria-invalid={!!errors.fullName} {...register("fullName")} />
        </Field>
        <Field label="رقم الهاتف" error={errors.phone?.message}>
          <Input id="phone" type="tel" dir="auto" placeholder="06 12 34 56 78" autoComplete="tel" aria-invalid={!!errors.phone} {...register("phone")} />
        </Field>
      </div>

      {/* Wilaya select */}
      <Field label="الولاية" error={!selectedWilaya && submitError ? "يرجى اختيار الولاية" : undefined}>
        <select
          value={selectedWilaya}
          onChange={(e) => { setSelectedWilaya(e.target.value ? Number(e.target.value) : ""); setSelectedBaladia(""); }}
          className="h-9 w-full border border-input bg-transparent px-3 text-sm" style={{ borderRadius: "var(--theme-input-radius)" }}
        >
          <option value="">اختر الولاية...</option>
          {wilayas.map((w) => (
            <option key={w.id} value={w.id}>{w.code} — {w.nameAr ?? w.name}</option>
          ))}
        </select>
      </Field>

      {/* Baladia select — filtered by selected wilaya */}
      {selectedWilayaData && (
        <Field label="البلدية" error={!selectedBaladia && submitError ? "يرجى اختيار البلدية" : undefined}>
          <select
            value={selectedBaladia}
            onChange={(e) => setSelectedBaladia(e.target.value ? Number(e.target.value) : "")}
            className="h-9 w-full border border-input bg-transparent px-3 text-sm" style={{ borderRadius: "var(--theme-input-radius)" }}
          >
            <option value="">اختر البلدية...</option>
            {selectedWilayaData.baladias.map((b) => (
              <option key={b.id} value={b.id}>{b.nameAr ?? b.name}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="ملاحظات الطلب (اختياري)" error={errors.notes?.message}>
        <Textarea id="notes" dir="auto" rows={2} placeholder="معلم، تفضيل وقت التوصيل..." {...register("notes")} />
      </Field>

      <QuantityStepper store={store} />

      {/* Shipping + total summary */}
      {selectedWilaya !== "" && (
        <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm" dir="rtl">
          <div className="flex justify-between">
            <span className="text-muted-foreground">المنتج ({formatPrice(unitPrice, currency)} × {quantity})</span>
            <span className="tabular-nums">{formatPrice(subtotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">سعر التوصيل</span>
            <span className="tabular-nums">
              {shipping !== null ? formatPrice(shipping, currency) : "غير متاح"}
            </span>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <span>الإجمالي</span>
            <span className="tabular-nums">{formatPrice(grandTotal, currency)}</span>
          </div>
        </div>
      )}

      {submitError && (
        <p className="text-sm text-destructive" role="alert">{submitError}</p>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={submitting}
        className="h-14 w-full text-base font-bold shadow-lg transition-all hover:shadow-xl"
        style={{
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-primary-foreground)",
          borderRadius: "var(--theme-button-radius)",
        }}
      >
        {submitting ? <Loader2 className="size-5 animate-spin" /> : null}
        {submitting ? "جاري الإرسال..." : `${buttonText} · ${formatPrice(grandTotal, currency)}`}
      </Button>

      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" style={{ color: "var(--theme-accent)" }} /> ضمان 30 يوم</span>
        <span className="inline-flex items-center gap-1.5"><Truck className="size-3.5" style={{ color: "var(--theme-accent)" }} /> توصيل 24-72 ساعة</span>
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={label.replace(/\s+/g, "").toLowerCase()}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
