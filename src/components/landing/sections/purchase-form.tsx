"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Minus, Plus, ShieldCheck, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";
import { useOrderTotals } from "@/lib/landing/store";

// Validation schema for the COD purchase form. Defined here (not in a shared
// lib) because submission handling belongs to a later task — when the webhook
// integration lands, this schema moves to a shared location and a server
// action/route reuses it for input validation. Phone is kept permissive for
// international formats; stricter normalization happens server-side later.
const purchaseSchema = z.object({
  fullName: z.string().min(2, "Please enter your full name"),
  phone: z.string().min(6, "Please enter a valid phone number"),
  wilaya: z.string().min(2, "Please select your wilaya"),
  baladia: z.string().min(2, "Please select your baladia"),
  address: z.string().min(5, "Please enter your delivery address"),
  notes: z.string().optional(),
});

type PurchaseFormValues = z.infer<typeof purchaseSchema>;

// Quantity stepper. Wired to the shared store (not RHF) so the order summary
// reacts instantly. Separated because quantity affects pricing, not the
// submission payload directly — though it will be appended on submit later.
function QuantityStepper({ store }: { store: LandingOrderStore }) {
  const quantity = store((s) => s.quantity);
  const setQuantity = store((s) => s.setQuantity);

  return (
    <div>
      <Label className="mb-2">Quantity</Label>
      <div className="inline-flex items-center rounded-lg border">
        <button
          type="button"
          aria-label="Decrease quantity"
          onClick={() => setQuantity(quantity - 1)}
          className="grid size-10 place-items-center rounded-l-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Minus className="size-4" />
        </button>
        <span
          className="w-12 text-center text-sm font-semibold tabular-nums"
          aria-live="polite"
          aria-label={`Quantity ${quantity}`}
        >
          {quantity}
        </span>
        <button
          type="button"
          aria-label="Increase quantity"
          onClick={() => setQuantity(quantity + 1)}
          className="grid size-10 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function PurchaseForm({
  store,
  buttonText,
  currency,
}: {
  store: LandingOrderStore;
  buttonText: string;
  currency: string;
}) {
  const { total } = useOrderTotals(store);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    mode: "onBlur",
  });

  // No submission logic yet — this is frontend-only. The handler is wired so
  // the button is a real submit (not a no-op div), and the schema runs so the
  // UX is testable. The webhook call arrives in a later task.
  const onSubmit = handleSubmit((values) => {
    console.log("[LandingOS] purchase intent (frontend only)", {
      ...values,
      quantity: store.getState().quantity,
      total,
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.fullName?.message}>
          <Input
            id="fullName"
            placeholder="Jane Doe"
            autoComplete="name"
            aria-invalid={!!errors.fullName}
            {...register("fullName")}
          />
        </Field>
        <Field label="Phone number" error={errors.phone?.message}>
          <Input
            id="phone"
            type="tel"
            placeholder="+213 6 12 34 56 78"
            autoComplete="tel"
            aria-invalid={!!errors.phone}
            {...register("phone")}
          />
        </Field>
        <Field label="Wilaya" error={errors.wilaya?.message}>
          <Input
            id="wilaya"
            placeholder="Alger"
            autoComplete="address-level1"
            aria-invalid={!!errors.wilaya}
            {...register("wilaya")}
          />
        </Field>
        <Field label="Baladia" error={errors.baladia?.message}>
          <Input
            id="baladia"
            placeholder="Bab El Oued"
            autoComplete="address-level2"
            aria-invalid={!!errors.baladia}
            {...register("baladia")}
          />
        </Field>
      </div>

      <Field label="Delivery address" error={errors.address?.message}>
        <Input
          id="address"
          placeholder="Street, building, floor, apartment"
          autoComplete="street-address"
          aria-invalid={!!errors.address}
          {...register("address")}
        />
      </Field>

      <Field label="Order notes (optional)" error={errors.notes?.message}>
        <Textarea
          id="notes"
          rows={2}
          placeholder="Landmark, delivery time preference…"
          {...register("notes")}
        />
      </Field>

      <QuantityStepper store={store} />

      <Button
        type="submit"
        size="lg"
        className="h-12 w-full rounded-xl text-base font-semibold shadow-sm"
      >
        {buttonText} · {formatPrice(total, currency)}
      </Button>

      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> 30-day warranty
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Truck className="size-3.5" /> 24–72h delivery
        </span>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={label.replace(/\s+/g, "").toLowerCase()}>{label}</Label>
      {children}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
