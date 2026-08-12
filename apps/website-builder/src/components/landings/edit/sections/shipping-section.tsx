"use client";

import * as React from "react";
import { Truck, Store, BadgePercent, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  SectionShell,
  useSectionState,
  refuseIfFailed,
} from "@/components/landings/edit/section";
import type { ShippingPreviewValues } from "@/types/preview";
import { useBuilderApi } from "@/lib/builder/api-base";
import { PageDeliveryPrices, type DeliveryOverride } from "./page-delivery-prices";

// Which shipping methods this product offers.
//
// Two independent toggles rather than a three-way Home/Desk/Both radio: "both"
// is not a third option, it is both of the two. Modelling it as a radio would
// mean re-deriving the flags on every read, and a third carrier later would
// need five radio options instead of one more checkbox.
//
// Per-wilaya prices for both methods are configured globally in Delivery
// Prices, not here — this only decides which methods this product offers.

/* The two method NAMES reuse `settings.homeDelivery` / `settings.stopDesk` —
 * the delivery-prices screen already names them for the same carriers, and a
 * second wording would let the two screens disagree about one thing.
 *
 * The subtitle is the carrier's own short code, and it stays French in every
 * locale on purpose: "Domicile" and "Bureau" are what the carrier's paperwork
 * and dashboards say in Algeria, so a merchant matching this screen against a
 * ZR or Ecom manifest is matching the same word. In the French console the
 * gloss reads a little redundantly beside the French title — recorded in
 * EDITOR_I18N.md §3 as a wording call rather than decided here. */
const METHODS = [
  {
    key: "homeDeliveryEnabled" as const,
    icon: Truck,
    titleKey: "settings.homeDelivery",
    subtitleKey: "builder.editor.homeDeliveryGloss",
    descriptionKey: "builder.editor.homeDeliveryDesc",
  },
  {
    key: "stopDeskEnabled" as const,
    icon: Store,
    titleKey: "settings.stopDesk",
    subtitleKey: "builder.editor.stopDeskGloss",
    descriptionKey: "builder.editor.stopDeskDesc",
  },
];

export function ShippingSection({
  landingId,
  initialValues,
  onPreviewChange,
}: {
  landingId: string;
  initialValues: ShippingPreviewValues;
  onPreviewChange: (values: ShippingPreviewValues) => void;
}) {
  // Where this editor sends its requests. The legacy dashboard and the
  // console mount the same components against different bases.
  const api = useBuilderApi();
  const t = useTranslations();
  const [values, setValues] = React.useState<ShippingPreviewValues>(initialValues);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  /* LB.20 — this product's delivery-price exceptions, loaded once and saved
     with the methods. One thought ("desk only, and dearer in Adrar"), one
     save: two buttons would be two chances to do half of it. */
  const [overrides, setOverrides] = React.useState<DeliveryOverride[]>([]);
  React.useEffect(() => {
    fetch(api(`/landings/${landingId}/delivery-prices`))
      .then((r) => r.json())
      .then((json) => {
        if (!json?.success || !Array.isArray(json.data?.items)) return;
        setOverrides(
          json.data.items.map((r: { wilayaId: number; homePrice: string; deskPrice: string | null }) => ({
            wilayaId: r.wilayaId,
            homePrice: r.homePrice,
            deskPrice: r.deskPrice ?? "",
          })),
        );
      })
      .catch(() => {
        // The section still works for the methods; the list stays empty rather
        // than taking the whole editor down over a price list.
      });
    /* ON MOUNT ONLY, and the empty array is load-bearing rather than lazy.
     *
     * `useBuilderApi()` builds a NEW closure on every render (see
     * lib/builder/api-base.tsx — it returns an arrow, not a memo), so listing
     * `api` here re-runs this effect on every single render and calls
     * `setOverrides` with the SERVER's rows. The symptom is that a row the
     * merchant just added disappears a moment later, and no unit test sees it
     * because it needs two renders. Found by driving the real control.
     *
     * `landingId` cannot change without remounting the editor. Every other
     * section in this directory loads its data the same way for the same
     * reason. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const section = useSectionState({
    save: async () => {
      const res = await fetch(api(`/landings/${landingId}/shipping`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      refuseIfFailed(await res.json());

      /* A row with no home price is INCOMPLETE, not an instruction to charge
         nothing — so it is dropped rather than sent as zero. The alternative
         is a product that silently ships free to one wilaya because somebody
         opened a row and did not finish it. */
      const items = overrides
        .filter((r) => r.homePrice.trim() !== "")
        .map((r) => ({
          wilayaId: r.wilayaId,
          homePrice: r.homePrice.trim(),
          deskPrice: r.deskPrice.trim() === "" ? null : r.deskPrice.trim(),
        }));

      const priced = await fetch(api(`/landings/${landingId}/delivery-prices`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      refuseIfFailed(await priced.json());
    },
  });

  React.useEffect(() => {
    onPreviewChange(values);
  }, [values, onPreviewChange]);

  const toggle = (key: keyof ShippingPreviewValues) => {
    setValues((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Blocked in the UI as well as the API: turning the last method off
      // would leave a product no customer could order, and catching it on the
      // click explains why instead of failing on save. `freeShipping` is not
      // a method — free-of-charge is still delivered — so it never trips this.
      if (!next.homeDeliveryEnabled && !next.stopDeskEnabled) {
        setValidationError(t("builder.editor.oneMethodRequired"));
        return prev;
      }
      setValidationError(null);
      return next;
    });
    section.markDirty();
  };

  const handleCancel = () => {
    setValues(initialValues);
    setValidationError(null);
    section.reset();
  };

  const enabledCount = Number(values.homeDeliveryEnabled) + Number(values.stopDeskEnabled);

  return (
    <SectionShell
      id="shipping"
      title={t("builder.editor.shipping")}
      description={t("builder.editor.shippingDesc")}
      icon={Truck}
      state={section.state}
      onSave={section.save}
      onCancel={handleCancel}
    >
      <div className="flex flex-col gap-3">
        {validationError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" />
            {validationError}
          </p>
        )}

        {/* CAPABILITY_AUDIT B2 — the checkout has zeroed the delivery charge
            on this flag since the port; this switch is the half that was
            missing. Separate from METHODS: free is a price, not a method. */}
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
            values.freeShipping ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
          )}
        >
          <input
            type="checkbox"
            checked={values.freeShipping}
            onChange={() => toggle("freeShipping")}
            className="mt-1 size-4 accent-primary"
          />
          <BadgePercent
            className={cn(
              "mt-0.5 size-4 shrink-0",
              values.freeShipping ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span className="flex flex-col gap-0.5">
            {/* No French gloss here, unlike the two methods below: "Livraison
                gratuite" IS the French translation, so the gloss existed only
                to give a French term to an English screen. */}
            <span className="text-sm font-medium">
              {t("builder.editor.freeShipping")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("builder.editor.freeShippingHint")}
            </span>
          </span>
        </label>

        {METHODS.map((method) => {
          const checked = values[method.key];
          const Icon = method.icon;
          return (
            <label
              key={method.key}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                checked ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(method.key)}
                className="mt-1 size-4 accent-primary"
              />
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  checked ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {t(method.titleKey)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {t(method.subtitleKey)}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t(method.descriptionKey)}
                </span>
              </span>
            </label>
          );
        })}

        <PageDeliveryPrices rows={overrides} onChange={(rows) => { setOverrides(rows); section.markDirty(); }} />

        <p className="text-[11px] text-muted-foreground">
          {enabledCount === 1
            ? t("builder.editor.oneMethodHint")
            : t("builder.editor.bothMethodsHint")}{" "}
          {t("builder.editor.stopDeskWilayaNote")}
        </p>
      </div>
    </SectionShell>
  );
}
