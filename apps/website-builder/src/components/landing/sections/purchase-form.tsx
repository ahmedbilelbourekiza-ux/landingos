"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Minus, Plus, ShieldCheck, Truck, Store, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";
import { useOrderTotals, useUnitPrice } from "@/lib/landing/store";
import { readMetaCookies, trackInitiateCheckout } from "@/components/landing/meta-pixel-loader";
import { useDraftCapture } from "@/lib/landing/use-draft-capture";
import { normalizeOrder, type OrderFormConfig } from "@/lib/landing/mock-order-form";
import type { ShippingMethod } from "@/types/landing";
import { useStorefrontApi, useStorefrontHref } from "@/lib/storefront/api-base";
import type { CheckoutBodyInput, CheckoutSuccess, WilayaItem } from "@/lib/storefront/contract";

// The customer-facing checkout.
//
// Field order, labels, placeholders, and visibility all come from the admin's
// OrderFormConfig — this component used to hardcode them, which is why the
// Order Form editor had no effect on the live page. `order` drives a switch
// rather than a fixed JSX sequence, so dragging a field in the dashboard
// moves it here.
//
// Three kinds of state, deliberately not unified:
//   - react-hook-form  — free-text inputs that need validation messages
//   - local useState   — wilaya/baladia, which cascade and are <select>s
//   - the order store  — quantity, shared with the sticky buy button
//
// Validation is built from the config rather than fixed, because whether a
// field is required is now the admin's decision.

interface WilayaPrices {
  home: number | null;
  desk: number | null;
}

// Fixed shape regardless of config: the same three inputs always exist, and
// only their required-ness changes. Declaring it here keeps useForm's generic
// stable while the zod schema below varies per product.
type PurchaseFormValues = {
  fullName?: string;
  phone?: string;
  notes?: string;
};

function QuantityStepper({
  store,
  label,
}: {
  store: LandingOrderStore;
  label: string;
}) {
  const quantity = store((s) => s.quantity);
  const setQuantity = store((s) => s.setQuantity);
  return (
    <div>
      <Label className="mb-2">{label}</Label>
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
  productTitle,
  buttonText,
  currency,
  config,
  homeDeliveryEnabled,
  stopDeskEnabled,
}: {
  store: LandingOrderStore;
  landingId: string;
  productTitle: string;
  buttonText: string;
  currency: string;
  config: OrderFormConfig;
  homeDeliveryEnabled: boolean;
  stopDeskEnabled: boolean;
}) {
  // Bound to this storefront tenant by StorefrontApiProvider.
  const api = useStorefrontApi();
  const href = useStorefrontHref();
  const router = useRouter();
  const { subtotal } = useOrderTotals(store);
  const unitPrice = useUnitPrice(store);
  const quantity = store((s) => s.quantity);

  // Meta Pixel InitiateCheckout. The form is rendered inline rather than in
  // a modal, so there is no literal "open" moment — the customer's first
  // interaction with any field is the equivalent signal. Fired at most once
  // per page view.
  const checkoutTracked = React.useRef(false);
  const handleFirstInteraction = React.useCallback(() => {
    if (checkoutTracked.current) return;
    checkoutTracked.current = true;
    const state = store.getState();
    trackInitiateCheckout({
      content_ids: [landingId],
      content_name: productTitle,
      value: subtotal,
      currency,
      num_items: state.quantity,
    });
  }, [store, landingId, productTitle, subtotal, currency]);

  const [wilayas, setWilayas] = React.useState<WilayaItem[]>([]);
  const [selectedWilaya, setSelectedWilaya] = React.useState<number | "">("");
  const [selectedBaladia, setSelectedBaladia] = React.useState<number | "">("");
  const [prices, setPrices] = React.useState<Record<number, WilayaPrices>>({});
  const [shippingMethod, setShippingMethod] = React.useState<ShippingMethod | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const fieldOrder = React.useMemo(() => normalizeOrder(config.order), [config.order]);

  // Required-ness follows the config, so a field the admin marked optional
  // stops blocking submission. Gated on `visible` too — validating a field
  // the customer cannot see would produce an unfixable error.
  const schema = React.useMemo(() => {
    const req = (key: "customerName" | "phone") =>
      config[key].visible && config[key].required;
    return z.object({
      fullName: req("customerName")
        ? z.string().min(2, "يرجى إدخال الاسم الكامل")
        : z.string().optional(),
      phone: req("phone")
        ? z.string().min(6, "يرجى إدخال رقم هاتف صحيح")
        : z.string().optional(),
      notes: z.string().optional(),
    });
  }, [config]);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<PurchaseFormValues>({
    // Cast because the schema is assembled at runtime from the config: each
    // branch infers a different type (string vs string | undefined), so the
    // resolver's generic cannot match the single form-values type. The fields
    // are the same either way — only whether they are required changes.
    resolver: zodResolver(schema) as unknown as Resolver<PurchaseFormValues>,
    mode: "onBlur",
  });

  // Abandoned-checkout capture. Saves whatever has been typed so far so a
  // phone number is recovered even if the customer never submits.
  const draft = useDraftCapture(landingId);
  const watchedName = watch("fullName");
  const watchedPhone = watch("phone");
  const draftUpdate = draft.update;

  React.useEffect(() => {
    const state = store.getState();
    // Names, not ids — the wilaya list is loaded async, so resolve defensively
    // and send null until it arrives rather than a number the server refuses.
    const wilayaName =
      selectedWilaya === ""
        ? null
        : wilayas.find((w) => w.id === Number(selectedWilaya))?.name ?? null;
    const baladiaName =
      selectedWilaya === "" || selectedBaladia === ""
        ? null
        : wilayas
            .find((w) => w.id === Number(selectedWilaya))
            ?.baladias.find((b) => b.id === Number(selectedBaladia))?.name ?? null;
    draftUpdate({
      customerName: watchedName,
      phone: watchedPhone,
      wilaya: wilayaName,
      baladia: baladiaName,
      quantity: state.quantity,
      variants: state.groups.map((g) => ({
        name: g.name,
        value: state.selected[g.name] ?? g.options[0]?.value ?? "",
      })),
    });
  }, [draftUpdate, store, watchedName, watchedPhone, selectedWilaya, selectedBaladia, quantity, wilayas]);

  // Load the destinations on mount. ONE request: the wilayas route embeds this
  // tenant's delivery prices per row (as Decimal STRINGS — M-06), so the price
  // map is derived rather than fetched again. The response is the platform
  // envelope `{ data: { items } }`; reading `data` directly is the exact
  // mistake that took the whole page down (B-01).
  React.useEffect(() => {
    fetch(api("/wilayas"))
      .then((r) => r.json())
      .then((json) => {
        if (!json?.success || !Array.isArray(json.data?.items)) return;
        const items: WilayaItem[] = json.data.items;
        setWilayas(items);
        const map: Record<number, WilayaPrices> = {};
        for (const w of items) {
          map[w.id] = {
            home: w.homePrice == null ? null : Number(w.homePrice),
            desk: w.deskPrice == null ? null : Number(w.deskPrice),
          };
        }
        setPrices(map);
      })
      .catch(() => {
        // A failed load leaves the destination list empty; the form still
        // renders and the customer can retry by reloading. Never crash the
        // page a customer is trying to buy from.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedWilayaData = wilayas.find((w) => w.id === Number(selectedWilaya));
  const wilayaPrices: WilayaPrices | null =
    selectedWilaya === "" ? null : prices[Number(selectedWilaya)] ?? null;

  // A method is offered only if the product enables it AND the chosen wilaya
  // has a price for it. Both conditions matter: a product can offer stop desk
  // while a particular wilaya has no desk price configured, and quoting the
  // home price for it would undercharge the customer.
  const availableMethods = React.useMemo<ShippingMethod[]>(() => {
    if (!wilayaPrices) return [];
    const methods: ShippingMethod[] = [];
    if (homeDeliveryEnabled && wilayaPrices.home !== null) methods.push("HOME");
    if (stopDeskEnabled && wilayaPrices.desk !== null) methods.push("DESK");
    return methods;
  }, [wilayaPrices, homeDeliveryEnabled, stopDeskEnabled]);

  // Keep the selection valid as the wilaya changes: default to the first
  // available method, and drop a selection that the new wilaya cannot serve.
  React.useEffect(() => {
    if (availableMethods.length === 0) {
      setShippingMethod(null);
      return;
    }
    setShippingMethod((current) =>
      current && availableMethods.includes(current) ? current : availableMethods[0],
    );
  }, [availableMethods]);

  const shipping =
    shippingMethod === "DESK"
      ? wilayaPrices?.desk ?? null
      : shippingMethod === "HOME"
        ? wilayaPrices?.home ?? null
        : null;
  const grandTotal = subtotal + (shipping ?? 0);

  const onSubmit = handleSubmit(async (values) => {
    if (submitting) return;
    if (!selectedWilaya || !selectedBaladia) {
      setSubmitError("يرجى اختيار الولاية والبلدية");
      return;
    }
    if (!shippingMethod || shipping === null) {
      setSubmitError("التوصيل غير متاح للولاية المختارة");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const state = store.getState();
      // The API prices from variant IDS (never from anything the client could
      // price itself), so the selection is resolved to ids here. A value with
      // no matching option contributes nothing rather than blocking the sale.
      const variantIds = state.groups
        .map((g) => {
          const chosen = state.selected[g.name] ?? g.options[0]?.value;
          return g.options.find((o) => o.value === chosen)?.id;
        })
        .filter((id): id is string => Boolean(id));

      // The baladia travels as a NAME snapshot, like the order stores it.
      const baladiaName =
        selectedWilayaData?.baladias.find((b) => b.id === Number(selectedBaladia))?.name ?? "";

      const { fbc, fbp } = readMetaCookies();
      const body: CheckoutBodyInput = {
        landingPageId: landingId,
        customerName: values.fullName ?? "",
        phone: values.phone ?? "",
        wilayaId: Number(selectedWilaya),
        baladiaName,
        notes: values.notes || undefined,
        quantity: state.quantity,
        variantIds,
        shippingMethod,
        fbc: fbc ?? undefined,
        fbp: fbp ?? undefined,
        draftToken: draft.token ?? undefined,
      };
      const res = await fetch(api("/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setSubmitError(json.error?.message || "فشل إرسال الطلب");
        setSubmitting(false);
        return;
      }
      // Stop the capture hook — otherwise navigating away would fire a final
      // beacon and re-open a lead this customer just converted.
      draft.markConverted();
      const data = json.data as CheckoutSuccess;
      // Tenant-aware: a bare "/thank-you/…" from a prefixed storefront lands
      // in the platform's root namespace and 404s (B-03).
      router.push(href(`/thank-you/${data.id}`));
    } catch {
      setSubmitError("خطأ في الشبكة — يرجى المحاولة مرة أخرى");
      setSubmitting(false);
    }
  });

  // One field, chosen by key. Returning null for a hidden field keeps the
  // ordering logic in one place instead of filtering in several.
  const renderField = (key: string) => {
    switch (key) {
      case "customerName":
        if (!config.customerName.visible) return null;
        return (
          <Field key={key} label={config.customerName.label} error={errors.fullName?.message}>
            <Input
              id="fullName"
              dir="auto"
              placeholder={config.customerName.placeholder}
              autoComplete="name"
              aria-invalid={!!errors.fullName}
              {...register("fullName")}
            />
          </Field>
        );

      case "phone":
        if (!config.phone.visible) return null;
        return (
          <Field key={key} label={config.phone.label} error={errors.phone?.message}>
            <Input
              id="phone"
              type="tel"
              dir="auto"
              placeholder={config.phone.placeholder}
              autoComplete="tel"
              aria-invalid={!!errors.phone}
              {...register("phone")}
            />
          </Field>
        );

      case "wilaya":
        if (!config.wilaya.visible) return null;
        return (
          <Field
            key={key}
            label={config.wilaya.label}
            error={!selectedWilaya && submitError ? "يرجى اختيار الولاية" : undefined}
          >
            <select
              value={selectedWilaya}
              onChange={(e) => {
                setSelectedWilaya(e.target.value ? Number(e.target.value) : "");
                // Baladias belong to a wilaya, so a stale selection here would
                // submit a commune from the previous wilaya.
                setSelectedBaladia("");
              }}
              className="h-9 w-full border border-input bg-transparent px-3 text-sm"
              style={{ borderRadius: "var(--theme-input-radius)" }}
            >
              <option value="">{config.wilaya.placeholder}</option>
              {wilayas.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.nameAr ?? w.name}</option>
              ))}
            </select>
          </Field>
        );

      case "baladia":
        // Only meaningful once a wilaya is chosen — it has nothing to list
        // before that.
        if (!config.baladia.visible || !selectedWilayaData) return null;
        return (
          <Field
            key={key}
            label={config.baladia.label}
            error={!selectedBaladia && submitError ? "يرجى اختيار البلدية" : undefined}
          >
            <select
              value={selectedBaladia}
              onChange={(e) => setSelectedBaladia(e.target.value ? Number(e.target.value) : "")}
              className="h-9 w-full border border-input bg-transparent px-3 text-sm"
              style={{ borderRadius: "var(--theme-input-radius)" }}
            >
              <option value="">{config.baladia.placeholder}</option>
              {selectedWilayaData.baladias.map((b) => (
                <option key={b.id} value={b.id}>{b.nameAr ?? b.name}</option>
              ))}
            </select>
          </Field>
        );

      case "notes":
        if (!config.notes.visible) return null;
        return (
          <Field key={key} label={config.notes.label} error={errors.notes?.message}>
            <Textarea
              id="notes"
              dir="auto"
              rows={2}
              placeholder={config.notes.placeholder}
              {...register("notes")}
            />
          </Field>
        );

      case "quantity":
        if (!config.quantity.visible) return null;
        return <QuantityStepper key={key} store={store} label={config.quantity.label} />;

      // `address` is intentionally unhandled: POST /api/orders neither accepts
      // nor stores one, so rendering it would collect a value the system
      // discards. parseOrderFormConfig also forces it hidden.
      default:
        return null;
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      onFocusCapture={handleFirstInteraction}
      onChange={handleFirstInteraction}
      className="flex flex-col gap-4"
      noValidate
    >
      {fieldOrder.map(renderField)}

      {/* Shipping method. Hidden unless the customer actually has a choice —
          with one method there is nothing to pick and a single locked radio
          is just noise. It still submits, because shippingMethod is set. */}
      {availableMethods.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label>طريقة التوصيل</Label>
          <div className="grid grid-cols-2 gap-2">
            {availableMethods.map((method) => {
              const active = shippingMethod === method;
              const price = method === "DESK" ? wilayaPrices?.desk : wilayaPrices?.home;
              const Icon = method === "DESK" ? Store : Truck;
              return (
                <button
                  key={method}
                  type="button"
                  onClick={() => setShippingMethod(method)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-center gap-1 border px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "border-transparent font-semibold"
                      : "border-input hover:bg-accent",
                  )}
                  style={{
                    borderRadius: "var(--theme-input-radius)",
                    ...(active
                      ? {
                          backgroundColor: "var(--theme-primary)",
                          color: "var(--theme-primary-foreground)",
                        }
                      : {}),
                  }}
                >
                  <Icon className="size-4" />
                  <span>{method === "DESK" ? "مكتب التوصيل" : "التوصيل للمنزل"}</span>
                  {price !== null && price !== undefined && (
                    <span className="text-xs tabular-nums opacity-80">
                      {formatPrice(price, currency)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Shipping + total summary */}
      {selectedWilaya !== "" && (
        <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm" dir="rtl">
          <div className="flex justify-between">
            <span className="text-muted-foreground">المنتج ({formatPrice(unitPrice, currency)} × {quantity})</span>
            <span className="tabular-nums">{formatPrice(subtotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              سعر التوصيل
              {shippingMethod && availableMethods.length > 1 && (
                <span className="mr-1 text-xs">
                  ({shippingMethod === "DESK" ? "مكتب" : "منزل"})
                </span>
              )}
            </span>
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
