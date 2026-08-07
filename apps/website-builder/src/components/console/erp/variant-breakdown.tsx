import { ProductThumb } from "./product-thumb";
import { StockChip, type StockLabels } from "./stock-chip";
import { stockLevel } from "@/lib/erp/stock-level";

/* =============================================================================
 * A product's variants, opened out — PM.3.
 *
 * NO DIRECTIVE, no state: it is the body of an expanded table row, rendered on
 * the server like the row above it. The disclosure itself is a checkbox and a
 * CSS `:has()` rule (see `DataTable`), so a catalogue of 200 products ships no
 * JavaScript to open one of them.
 *
 * WHAT IT ANSWERS THAT THE GRID COULD NOT. The products table has a `variants`
 * column holding a COUNT — "12" — and a `stock` column holding the roll-up.
 * Both are true and neither is the question anybody has, which is: of the
 * twelve, which are gone? A shoe with 200 units is not fine if 199 of them are
 * size 45, and the roll-up says 200 either way. The inventory screen answers it
 * on a separate screen, as a flat list across the whole catalogue, which is the
 * right shape for "what do I reorder" and the wrong one for "can I confirm this
 * order".
 *
 * GROUPED BY THE FIRST OPTION AXIS, like the editor and like the legacy —
 * because that is the axis a photograph belongs to, and a colour with four
 * sizes reads as one thing with four levels rather than as four rows.
 * ========================================================================== */

export interface BreakdownVariant {
  readonly name: string;
  readonly sku: string | null;
  readonly stock: number;
  readonly threshold: number;
  readonly image: string | null;
  readonly options: Record<string, string>;
}

export function VariantBreakdown({
  variants,
  optionDefs,
  productImage,
  labels,
  emptyLabel,
}: {
  readonly variants: readonly BreakdownVariant[];
  readonly optionDefs: readonly { name: string; values: string[] }[];
  /** Falls back here when a variant has no photograph of its own. */
  readonly productImage: string | null;
  readonly labels: StockLabels & { readonly groupTotal: string; readonly other: string };
  readonly emptyLabel: string;
}) {
  if (!variants.length) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  const usable = optionDefs.filter((d) => d.name?.trim() && d.values?.length);
  const outer = usable.length >= 2 ? usable[0] : null;

  const groups = new Map<string, BreakdownVariant[]>();
  if (outer) {
    for (const value of outer.values) groups.set(value, []);
    for (const v of variants) {
      const key = v.options?.[outer.name.trim()] ?? "";
      const bucket = groups.get(key);
      if (bucket) bucket.push(v);
      else groups.set(labels.other, [...(groups.get(labels.other) ?? []), v]);
    }
  } else {
    groups.set("", [...variants]);
  }

  const rendered = [...groups.entries()].filter(([, list]) => list.length);

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-4">
      {rendered.map(([label, list]) => {
        const total = list.reduce((sum, v) => sum + v.stock, 0);
        const cover = list.map((v) => v.image).find(Boolean) ?? productImage;
        return (
          <div key={label || "all"} data-variant-group={label || "all"} className="min-w-[13rem]">
            {label && (
              <div className="mb-1.5 flex items-center gap-2">
                <ProductThumb src={cover} alt="" size="xs" />
                <span className="text-xs font-semibold text-foreground">{label}</span>
                <span className="text-2xs text-muted-foreground" dir="ltr">
                  {labels.groupTotal}: {total}
                </span>
              </div>
            )}
            <ul className="space-y-1">
              {list.map((v) => (
                <li
                  key={v.name}
                  data-variant={v.name}
                  data-stock-severity={stockLevel(v.stock, v.threshold)}
                  className="flex items-center gap-2"
                >
                  <ProductThumb src={v.image || productImage} alt="" size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-foreground">{v.name || "—"}</span>
                    {v.sku && (
                      <span className="block truncate font-mono text-2xs text-muted-foreground" dir="ltr">
                        {v.sku}
                      </span>
                    )}
                  </span>
                  <StockChip
                    stock={v.stock}
                    threshold={v.threshold}
                    labels={labels}
                    showLabel={false}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
