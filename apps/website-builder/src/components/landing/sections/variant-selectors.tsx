"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/landing/format";
import { recordVariantChange } from "@/components/landing/visit-beacon";
import type { LandingOrderStore } from "@/lib/landing/store";
// VAR.2 — availability is per COMBINATION, and the rule lives in one shared
// module so the storefront, the checkout and the matrix cannot disagree.
import { isCombinationAvailable, type OptionAxis } from "@/lib/erp/variant-axes";

// One segmented control per variant group. Each option is a button; the
// selected option gets a solid fill. Extra-price adjustments shown inline.
export function VariantSelectors({
  store,
  currency,
}: {
  store: LandingOrderStore;
  currency: string;
}) {
  const groups = store((s) => s.groups);
  const selected = store((s) => s.selected);
  const select = store((s) => s.select);
  const stockByVariant = store((s) => s.stockByVariant);

  if (groups.length === 0) return null;

  /* The axes, in the shape the shared availability rule takes. Group order IS
     definition order here: `groupVariants` builds them from rows the page
     already returned sorted by `displayOrder`. */
  const axes: OptionAxis[] = groups.map((g) => ({
    name: g.name,
    values: g.options.map((o) => o.value),
  }));

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      {groups.map((group) => (
        <fieldset key={group.name}>
          <legend className="mb-2 text-sm font-medium">{group.name}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={group.name}>
            {group.options.map((option) => {
              const isSelected = selected[group.name] === option.value;
              /* VAR.2 — could this still be bought, given the other choices?
                 Nothing is disabled when the merchant has not turned
                 enforcement on, and nothing is disabled for a combination the
                 catalogue has no row for: taking a working product off sale
                 over a bookkeeping gap is worse than letting the call-centre
                 sort out a rare miss. The checkout refuses what it can SEE is
                 empty, so the guarantee does not depend on this. */
              const available = isCombinationAvailable(
                axes, selected, stockByVariant, group.name, option.value,
              );
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  /* Said, not just shown. A strikethrough is invisible to a
                     screen reader, and `disabled` is announced natively as
                     unavailable in every language — which is why there is no
                     tooltip here: the storefront has no string catalogue (all
                     its copy is the merchant's own fields), so a hardcoded
                     label would be untranslated text on a customer's page.
                     That is the exact mistake `checkout-messages.ts` exists
                     to have fixed. */
                  disabled={!available}
                  aria-disabled={!available}
                  data-out-of-stock={!available || undefined}
                  onClick={() => {
                    if (!available) return;
                    // BH.1 — interest depth; no-op unless the page opted in.
                    recordVariantChange();
                    select(group.name, option.value);
                  }}
                  style={isSelected ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-primary-foreground)", borderColor: "var(--theme-primary)" } : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isSelected
                      ? ""
                      : "border-border bg-background hover:border-foreground/40 hover:bg-accent/50",
                    // Greyed AND struck through, because colour alone is not a
                    // signal (the same rule the status vocabulary follows).
                    !available &&
                      "cursor-not-allowed opacity-40 line-through hover:border-border hover:bg-background",
                  )}
                >
                  {isSelected && <Check className="size-3.5" aria-hidden />}
                  <span>{option.value}</span>
                  {option.extraPrice > 0 && (
                    /* The softened GUARANTEED foreground, never the background
                       at partial opacity: background@70 over the primary is an
                       unguaranteed pair that measured 2.98–4.07:1 on four of
                       the six shipped palettes (19 Aug sweep — the LB.55 rule
                       applied to the chip). */
                    <span
                      className={cn("text-xs", !isSelected && "text-muted-foreground")}
                      style={
                        isSelected
                          ? { color: "var(--theme-primary-foreground-muted)" }
                          : undefined
                      }
                    >
                      +{formatPrice(option.extraPrice, currency)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
