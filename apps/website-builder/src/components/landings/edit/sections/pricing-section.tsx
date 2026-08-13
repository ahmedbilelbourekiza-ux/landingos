"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatPrice, discountPercentage } from "@/lib/landing/format";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import { Field } from "./field";
import { useBuilderApi } from "@/lib/builder/api-base";
import { MONEY_PATTERN, normaliseTypedMoney, readTypedMoney } from "@/lib/landing/money-field";

export interface PricingPreviewValues {
  price: number;
  oldPrice: number | null;
  currency: string;
}

/* The code is the stored value and never changes; only the NAME beside it is
 * read, so the list carries a key rather than a sentence. */
const PRICING_CURRENCIES = [
  { code: "DZD", labelKey: "builder.editor.currencyDZD" },
  { code: "EUR", labelKey: "builder.editor.currencyEUR" },
  { code: "USD", labelKey: "builder.editor.currencyUSD" },
] as const;

/** Built from `t` inside the component — see general-section.tsx's note. */
function buildPricingSchema(t: (key: string) => string) {
  /* The boxes are text (LB.15), so the schema reads them through the SAME
   * function the save body uses — `readTypedMoney`. A second reading here
   * would let the section refuse a price it goes on to send, or send one it
   * never validated.
   *
   * TWO refusals, not one, because they are two different mistakes: text that
   * cannot be read without guessing becomes NaN and is answered by the type
   * message ("write it in digits with one separator"), while a real number at
   * or below zero is answered by the positivity message. Collapsing them told
   * somebody who typed `1,000` that their price was not greater than zero,
   * which is both untrue and no help at all. */
  return z
    .object({
      price: z.preprocess(
        (v) => readTypedMoney(v) ?? Number.NaN,
        z
          .number({ error: t("builder.editor.priceUnreadable") })
          .positive(t("builder.editor.pricePositive")),
      ),
      oldPrice: z.preprocess(
        (v) => {
          const read = readTypedMoney(v);
          // An empty old price is a real answer — there is no "was" price.
          return read === undefined ? undefined : (read ?? Number.NaN);
        },
        z
          .number({ error: t("builder.editor.priceUnreadable") })
          .positive(t("builder.editor.oldPricePositive"))
          .optional(),
      ),
      currency: z.enum(["DZD", "EUR", "USD"]),
    })
    .superRefine((data, ctx) => {
      if (data.oldPrice !== undefined && data.oldPrice <= data.price) {
        ctx.addIssue({
          path: ["oldPrice"],
          code: z.ZodIssueCode.custom,
          message: t("builder.editor.oldPriceHigher"),
        });
      }
    });
}

/* Two types, not one, because the boxes and the verdict now differ: a field
 * holds TEXT and the schema answers with numbers. react-hook-form is typed on
 * the input side — that is what `register` writes and what `getValues` hands
 * back — and the resolver carries the parsed side. Collapsing them was what
 * made `getValues().price` look like a number while holding "2990,50". */
type PricingFormValues = z.input<ReturnType<typeof buildPricingSchema>>;
type PricingFormOutput = z.output<ReturnType<typeof buildPricingSchema>>;

export function PricingSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: PricingPreviewValues;
  onPreviewChange: (values: PricingPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const t = useTranslations();
  const schema = React.useMemo(() => buildPricingSchema(t), [t]);
  const form = useForm<PricingFormValues, unknown, PricingFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues as PricingFormValues,
    mode: "onBlur",
  });

  const section = useSectionState({
    save: async () => {
      const values = form.getValues();
      /* `getValues()` hands back what is IN the boxes, which since LB.15 is
       * text. It crosses the wire as the canonical string the same reader
       * produced for the schema — a `Decimal` column wants "2990.50", and the
       * save must not re-interpret what validation already accepted. Only a
       * validated form reaches here, so neither can be `null`. */
      const res = await fetch(api(`/landings/${landingId}/pricing`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: normaliseTypedMoney(values.price),
          oldPrice: normaliseTypedMoney(values.oldPrice) || null,
          currency: values.currency,
        }),
      });
      const json = await res.json();
      refuseIfFailed(json);
    },
  });

  const { register, control, setValue, trigger, reset } = form;

  const priceValue = useWatch({ control, name: "price" });
  const oldPriceValue = useWatch({ control, name: "oldPrice" });
  const currencyValue = useWatch({ control, name: "currency" });

  React.useEffect(() => {
    const sub = form.watch(() => section.markDirty());
    return () => sub.unsubscribe();
  }, [form, section]);

  /* The strip and the live preview read the boxes through the same function as
   * the schema and the save. `Number("2990,50")` is NaN, so reading the text
   * any other way here would blank the preview for a price the section is
   * about to accept — half-typed and unreadable both fall back to 0, because
   * this is a picture rather than a verdict. */
  const previewPrice = readTypedMoney(priceValue) ?? 0;
  const previewOldPrice = readTypedMoney(oldPriceValue) ?? null;

  React.useEffect(() => {
    onPreviewChange({
      price: previewPrice,
      oldPrice: previewOldPrice,
      currency: currencyValue ?? "DZD",
    });
  }, [previewPrice, previewOldPrice, currencyValue, onPreviewChange]);

  const handleSave = async () => {
    const valid = await trigger();
    if (!valid) return;
    await section.save();
  };

  const handleCancel = () => {
    reset(initialValues as PricingFormValues);
    section.reset();
  };

  const discount =
    previewOldPrice !== null ? discountPercentage(previewPrice, previewOldPrice) : null;

  const currency = currencyValue ?? "DZD";

  return (
    <SectionShell
      id="pricing"
      title={t("builder.editor.pricing")}
      description={t("builder.editor.pricingDesc")}
      icon={Tag}
      state={section.state}
      onSave={handleSave}
      onCancel={handleCancel}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap items-baseline gap-3 rounded-xl border bg-muted/30 p-4">
          <span className="text-2xl font-semibold tabular-nums">
            {formatPrice(previewPrice, currency)}
          </span>
          {previewOldPrice !== null && discount && (
            <>
              <span className="text-base text-muted-foreground line-through tabular-nums">
                {formatPrice(previewOldPrice, currency)}
              </span>
              <Badge className="bg-foreground text-background hover:bg-foreground">−{discount}%</Badge>
            </>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* Text with a decimal keypad, never `type="number"` — these are
              `Decimal` columns, and the spinner this replaces rounded a price
              (2990.50 → 2992 on two arrow presses, measured). `dir="ltr"`
              because a price is read left-to-right even in Arabic; it is the
              same money island the ERP panels and LB.20's overrides use, so
              never put an `rtl:` utility inside it (LB.28). */}
          <Field label={t("builder.editor.priceLabel")} error={form.formState.errors.price?.message} htmlFor="price" required>
            <Input id="price" type="text" inputMode="decimal" dir="ltr" pattern={MONEY_PATTERN} placeholder="2990" className="tabular-nums" aria-invalid={!!form.formState.errors.price} {...register("price")} />
          </Field>

          <Field label={t("builder.editor.oldPriceLabel")} error={form.formState.errors.oldPrice?.message as string | undefined} htmlFor="oldPrice" hint={t("builder.editor.oldPriceHint")}>
            <Input id="oldPrice" type="text" inputMode="decimal" dir="ltr" pattern={MONEY_PATTERN} placeholder="3900" className="tabular-nums" aria-invalid={!!form.formState.errors.oldPrice} {...register("oldPrice")} />
          </Field>

          <Field label={t("builder.editor.currencyLabel")} error={form.formState.errors.currency?.message} htmlFor="currency">
            <Select value={currency} onValueChange={(v) => setValue("currency", v as "DZD" | "EUR" | "USD", { shouldValidate: true })}>
              <SelectTrigger id="currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{t(c.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </form>
    </SectionShell>
  );
}
