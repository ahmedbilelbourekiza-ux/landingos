"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBuilderApi } from "@/lib/builder/api-base";
import { useStorefrontApi } from "@/lib/storefront/api-base";

/* =============================================================================
 * This product's delivery-price exceptions — LB.20's control.
 *
 * The company prices delivery once per wilaya in Settings. This lists only the
 * wilayas where THIS product costs something different, which is the shape the
 * data has: a heavy product is usually an exception in two or three places, not
 * a whole second price list. A grid of 58 rows would invite somebody to fill it
 * in, and a page that snapshotted every wilaya would stop tracking the
 * company's prices the moment one changed.
 *
 * THE WILAYA LIST COMES FROM THE STOREFRONT ROUTE the customer's form reads, so
 * a merchant cannot price a destination the storefront will not offer. That is
 * the same reasoning `preview-order-form.tsx` records for reading destinations
 * from the storefront endpoint rather than the console one.
 *
 * It does NOT own a save button. The Shipping section's footer saves it along
 * with the methods, because "this product ships to the desk only, and costs
 * more in Adrar" is one thought and two saves would be two chances to do half
 * of it.
 * ========================================================================== */

export interface DeliveryOverride {
  wilayaId: number;
  homePrice: string;
  deskPrice: string;
}

interface WilayaOption {
  id: number;
  code: string;
  name: string;
}

export function PageDeliveryPrices({
  rows,
  onChange,
}: {
  readonly rows: readonly DeliveryOverride[];
  readonly onChange: (rows: DeliveryOverride[]) => void;
}) {
  const t = useTranslations();
  const storefront = useStorefrontApi();
  const [wilayas, setWilayas] = React.useState<WilayaOption[]>([]);

  React.useEffect(() => {
    // Deliberately WITHOUT a landingPageId: this asks "where does the company
    // deliver at all", which is the set a merchant may write an exception for.
    // Passing the page would return the prices already overridden and make the
    // list depend on its own output.
    fetch(storefront("/wilayas"))
      .then((r) => r.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.data?.items)) setWilayas(json.data.items);
      })
      .catch(() => {
        // An empty list disables adding rather than crashing the section. The
        // merchant still sees and can remove whatever is already stored.
      });
    /* On mount only — `useStorefrontApi()` returns a new closure per render,
       so naming it here would re-fetch the wilaya list on every keystroke in
       a price field. Same hazard the Shipping section documents. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const used = new Set(rows.map((r) => r.wilayaId));
  const available = wilayas.filter((w) => !used.has(w.id));

  const update = (wilayaId: number, patch: Partial<DeliveryOverride>) =>
    onChange(rows.map((r) => (r.wilayaId === wilayaId ? { ...r, ...patch } : r)));

  return (
    <div className="mt-4 flex flex-col gap-2 rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{t("builder.editor.pageDeliveryPrices")}</span>
        <span className="text-[11px] text-muted-foreground">
          {t("builder.editor.pageDeliveryHint")}
        </span>
      </div>

      {rows.length === 0 && (
        <p className="py-2 text-xs text-muted-foreground">{t("builder.editor.noOverrides")}</p>
      )}

      {rows.map((row) => {
        const wilaya = wilayas.find((w) => w.id === row.wilayaId);
        return (
          <div key={row.wilayaId} className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2">
            <span className="min-w-28 flex-1 text-xs font-medium">
              {wilaya ? `${wilaya.code} — ${wilaya.name}` : `#${row.wilayaId}`}
            </span>
            <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
              {t("builder.editor.overrideHome")}
              {/* Money is text with a decimal keypad, never `type="number"` —
                  these are Decimal columns and a number input hands back a JS
                  float (M-06). */}
              <Input
                inputMode="decimal"
                dir="ltr"
                value={row.homePrice}
                onChange={(e) => update(row.wilayaId, { homePrice: e.target.value })}
                className="h-8 w-24"
                aria-label={`${wilaya?.name ?? row.wilayaId} — ${t("builder.editor.overrideHome")}`}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
              {t("builder.editor.overrideDesk")}
              <Input
                inputMode="decimal"
                dir="ltr"
                value={row.deskPrice}
                onChange={(e) => update(row.wilayaId, { deskPrice: e.target.value })}
                className="h-8 w-24"
                aria-label={`${wilaya?.name ?? row.wilayaId} — ${t("builder.editor.overrideDesk")}`}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              aria-label={t("builder.editor.removeOverride")}
              onClick={() => onChange(rows.filter((r) => r.wilayaId !== row.wilayaId))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}

      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            id="add-override"
            aria-label={t("builder.editor.addOverride")}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (!id) return;
              // Empty prices rather than a guess at the company's: a blank cell
              // is visibly unfinished, and pre-filling would make an untouched
              // row look like a deliberate exception.
              onChange([...rows, { wilayaId: id, homePrice: "", deskPrice: "" }]);
            }}
          >
            <option value="">{t("builder.editor.addOverride")}</option>
            {available.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
          <Plus className="size-3.5 text-muted-foreground" aria-hidden />
        </div>
      )}
    </div>
  );
}
