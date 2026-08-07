"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";

import { ImageInput, type ImageInputStrings } from "./image-input";
import { ProductThumb } from "./product-thumb";
import { StockChip, type StockLabels } from "./stock-chip";

/* =============================================================================
 * The variant matrix — PM.3, and the half of PM.2 that lives per variant.
 *
 * WHAT WAS WRONG WITH THE FLAT TABLE IT REPLACES. A clothing catalogue with
 * three colours and five sizes is fifteen rows; add a length and it is
 * forty-five. LP.18 built the generator that produces them correctly and then
 * rendered them as one undifferentiated list of text inputs, sorted by whatever
 * order the cross product happened to emit. Finding "how much Blue is left, in
 * any size" — the question `options` was stored to make answerable — meant
 * reading forty-five rows. The legacy CRM groups by the first axis, collapses a
 * group to one line, totals its stock on the header and lets a manager set one
 * photograph across a whole colour; this had none of it.
 *
 * THREE THINGS IT DOES THAT THE FLAT LIST COULD NOT:
 *
 *   1. GROUPS BY THE FIRST AXIS, with a running stock total per group. Colour
 *      first is not arbitrary — it is the axis a photograph belongs to, which
 *      is why the legacy picks the same one.
 *   2. COLLAPSES. Forty-five rows is a scroll; five collapsed groups is a
 *      catalogue. Open by default, because a matrix that starts closed hides
 *      the thing somebody opened the panel for.
 *   3. CARRIES A PHOTOGRAPH PER VARIANT, and lets one be applied to every
 *      variant in a group at once. Uploading the same photograph of a blue shoe
 *      once per size is the friction the legacy's group upload exists to
 *      remove, and the reason it exists is that people simply do not do it.
 *
 * WHAT IT DOES NOT DO: talk to the network. It is a controlled editor over rows
 * its parent owns, because the same matrix is used while CREATING a product
 * (posted with it, in one request) and while EDITING one (its own `PUT`, which
 * turns levels into ledger movements — D-LP.18.1). A component that saved
 * itself could only ever do one of those.
 * ========================================================================== */

export interface VariantRow {
  name: string;
  sku: string;
  stock: number;
  threshold: number;
  image: string;
  options: Record<string, string>;
}

export interface OptionDef {
  name: string;
  values: string[];
}

export interface VariantMatrixStrings {
  readonly optionName: string;
  readonly optionValues: string;
  readonly addOption: string;
  readonly generate: string;
  readonly generateHint: string;
  readonly variant: string;
  readonly sku: string;
  readonly stock: string;
  readonly threshold: string;
  readonly addVariant: string;
  readonly remove: string;
  readonly noVariants: string;
  readonly groupTotal: string;
  readonly other: string;
  readonly collapse: string;
  readonly expand: string;
  readonly image: ImageInputStrings;
  readonly groupImage: string;
  readonly stockLabels: StockLabels;
}

interface Group {
  readonly key: string;
  readonly label: string;
  readonly indexes: number[];
}

/**
 * Bucket the rows by the FIRST option axis.
 *
 * `null` when there is nothing to group by — fewer than two axes, or no axis
 * with a name. A flat list is the right rendering for a product with one axis,
 * and forcing groups of one onto it would add a chevron per row for nothing.
 */
function groupsOf(rows: readonly VariantRow[], defs: readonly OptionDef[]): {
  groups: Group[];
  innerDefs: OptionDef[];
} | null {
  const usable = defs.filter((d) => d.name.trim() && d.values.filter(Boolean).length);
  if (usable.length < 2) return null;

  const outer = usable[0];
  const innerDefs = usable.slice(1);
  const buckets = new Map<string, Group>(
    outer.values.filter(Boolean).map((v) => [v, { key: v, label: v, indexes: [] }]),
  );
  const other: Group = { key: "__other", label: "", indexes: [] };

  rows.forEach((row, i) => {
    const value = row.options?.[outer.name.trim()];
    const bucket = value ? buckets.get(value) : undefined;
    (bucket ?? other).indexes.push(i);
  });

  const groups = [...buckets.values()].filter((g) => g.indexes.length);
  if (other.indexes.length) groups.push(other);
  return { groups, innerDefs };
}

export function VariantMatrix({
  rows,
  setRows,
  defs,
  setDefs,
  s,
  testId = "variant-rows",
}: {
  readonly rows: readonly VariantRow[];
  readonly setRows: (next: VariantRow[]) => void;
  readonly defs: readonly OptionDef[];
  readonly setDefs: (next: OptionDef[]) => void;
  readonly s: VariantMatrixStrings;
  readonly testId?: string;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const setRow = (i: number, patch: Partial<VariantRow>) =>
    setRows(rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  /**
   * The cross product of every option definition.
   *
   * Rows that already exist are KEPT with their stock, their SKU and their
   * photograph — a generator that replaced the matrix would silently zero every
   * level it regenerated, which is a stock loss with no movement row behind it
   * and exactly what D-LP.18.1 forbids. The name is the values joined in
   * definition order, which is stable: regenerating after adding a size does
   * not rename everything, and it is what stops a catalogue growing
   * "M / Blue" and "Blue / M" as two rows holding separate stock.
   */
  const generate = () => {
    const usable = defs.filter((d) => d.name.trim() && d.values.filter(Boolean).length);
    if (!usable.length) return;

    let combos: Record<string, string>[] = [{}];
    for (const def of usable) {
      const next: Record<string, string>[] = [];
      for (const combo of combos) {
        for (const value of def.values.filter(Boolean)) {
          next.push({ ...combo, [def.name.trim()]: value });
        }
      }
      combos = next;
    }

    const byName = new Map(rows.map((r) => [r.name, r]));
    setRows(
      combos.map((options) => {
        const name = usable.map((d) => options[d.name.trim()]).join(" / ");
        return (
          byName.get(name) ?? { name, sku: "", stock: 0, threshold: 0, image: "", options }
        );
      }),
    );
  };

  /** One photograph across every variant in a group — the legacy's bulk upload,
   *  and the reason it exists is that nobody uploads the same picture six
   *  times. */
  const setGroupImage = (indexes: readonly number[], url: string) =>
    setRows(rows.map((row, idx) => (indexes.includes(idx) ? { ...row, image: url } : row)));

  const grouped = groupsOf(rows, defs);

  const rowControls = (i: number, label: string) => {
    const row = rows[i];
    return (
      <div
        key={`${i}-${row.name}`}
        data-variant-row={row.name}
        className="flex flex-wrap items-start gap-3 border-t border-border px-3 py-2.5 first:border-t-0"
      >
        <ImageInput
          compact
          size="sm"
          alt={row.name}
          value={row.image}
          onChange={(image) => setRow(i, { image })}
          s={s.image}
          testId={`variant-image-${i}`}
        />
        <div className="min-w-[9rem] flex-1">
          <label className="ui-label block" htmlFor={`variant-name-${i}`}>
            {s.variant}
          </label>
          <input
            id={`variant-name-${i}`}
            data-testid={`variant-name-${i}`}
            value={row.name}
            onChange={(e) => setRow(i, { name: e.target.value })}
            className="ui-control mt-1 w-full"
          />
          {label && label !== row.name && (
            <span className="mt-1 block text-2xs text-muted-foreground">{label}</span>
          )}
        </div>
        <div className="w-28">
          <label className="ui-label block" htmlFor={`variant-sku-${i}`}>
            {s.sku}
          </label>
          <input
            id={`variant-sku-${i}`}
            data-testid={`variant-sku-${i}`}
            value={row.sku}
            dir="ltr"
            onChange={(e) => setRow(i, { sku: e.target.value })}
            className="ui-control mt-1 w-full"
          />
        </div>
        <div className="w-24">
          <label className="ui-label block" htmlFor={`variant-stock-${i}`}>
            {s.stock}
          </label>
          <input
            id={`variant-stock-${i}`}
            data-testid={`variant-stock-${i}`}
            inputMode="numeric"
            dir="ltr"
            value={String(row.stock)}
            onChange={(e) => setRow(i, { stock: Number(e.target.value) || 0 })}
            className="ui-control mt-1 w-full text-end"
          />
        </div>
        <div className="w-24">
          <label className="ui-label block" htmlFor={`variant-threshold-${i}`}>
            {s.threshold}
          </label>
          <input
            id={`variant-threshold-${i}`}
            data-testid={`variant-threshold-${i}`}
            inputMode="numeric"
            dir="ltr"
            value={String(row.threshold)}
            onChange={(e) => setRow(i, { threshold: Number(e.target.value) || 0 })}
            className="ui-control mt-1 w-full text-end"
          />
        </div>
        <div className="flex items-center gap-2 self-end pb-1">
          {/* The level being edited, judged against the threshold beside it.
              A number in a box says nothing; the same number as a chip says
              whether confirming an order for it is a promise anybody can
              keep. */}
          <StockChip
            stock={row.stock}
            threshold={row.threshold}
            labels={s.stockLabels}
            showLabel={false}
            onlyWhenAlert
          />
          <button
            type="button"
            data-testid={`variant-remove-${i}`}
            aria-label={`${s.remove} — ${row.name}`}
            title={s.remove}
            onClick={() => removeRow(i)}
            className="ui-btn ui-btn-ghost ui-btn-sm tap size-8 px-0"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* The option axes. */}
      <div className="space-y-2" data-testid="variant-options">
        {defs.map((def, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <label className="ui-label block" htmlFor={`option-name-${i}`}>
                {s.optionName}
              </label>
              <input
                id={`option-name-${i}`}
                data-testid={`option-name-${i}`}
                value={def.name}
                onChange={(e) =>
                  setDefs(defs.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                }
                className="ui-control mt-1 w-full"
              />
            </div>
            <div className="min-w-[12rem] flex-1">
              <label className="ui-label block" htmlFor={`option-values-${i}`}>
                {s.optionValues}
              </label>
              <input
                id={`option-values-${i}`}
                data-testid={`option-values-${i}`}
                value={def.values.join(", ")}
                onChange={(e) =>
                  setDefs(
                    defs.map((x, idx) =>
                      idx === i
                        ? { ...x, values: e.target.value.split(",").map((v) => v.trim()) }
                        : x,
                    ),
                  )
                }
                className="ui-control mt-1 w-full"
              />
            </div>
            <button
              type="button"
              onClick={() => setDefs(defs.filter((_, idx) => idx !== i))}
              className="ui-btn ui-btn-default ui-btn-sm tap"
            >
              {s.remove}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="variant-add-option"
          onClick={() => setDefs([...defs, { name: "", values: [] }])}
          className="ui-btn ui-btn-default ui-btn-sm tap"
        >
          {s.addOption}
        </button>
        <button
          type="button"
          data-testid="variant-generate"
          onClick={generate}
          className="ui-btn ui-btn-default ui-btn-sm tap"
        >
          {s.generate}
        </button>
        <span className="text-xs text-muted-foreground">{s.generateHint}</span>
      </div>

      <div
        className="mt-3 overflow-hidden rounded-lg border border-border bg-surface-raised"
        data-testid={testId}
      >
        {rows.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">{s.noVariants}</p>
        )}

        {rows.length > 0 && !grouped && rows.map((_, i) => rowControls(i, ""))}

        {grouped?.groups.map((group) => {
          const shut = collapsed.has(group.key);
          const total = group.indexes.reduce((sum, i) => sum + (Number(rows[i].stock) || 0), 0);
          const cover = group.indexes.map((i) => rows[i].image).find(Boolean) ?? "";
          const label = group.label || s.other;
          return (
            <div key={group.key} data-variant-group={group.key} className="border-t border-border first:border-t-0">
              <div className="flex items-center gap-2 bg-surface-subtle px-3 py-2">
                <button
                  type="button"
                  aria-expanded={!shut}
                  data-testid={`variant-group-toggle-${group.key}`}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  className="tap flex min-w-0 flex-1 items-center gap-2 rounded-md text-start"
                  title={shut ? s.expand : s.collapse}
                >
                  {shut ? (
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <ProductThumb src={cover || null} alt="" size="xs" />
                  <span className="truncate text-sm font-medium text-foreground">{label}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground" dir="ltr">
                    {group.indexes.length}
                  </span>
                </button>
                <span className="shrink-0 text-2xs text-muted-foreground" dir="ltr">
                  {s.groupTotal}: {total}
                </span>
                {/* One photograph for the whole colour. */}
                <ImageInput
                  buttonOnly
                  value=""
                  alt=""
                  onChange={(url) => url && setGroupImage(group.indexes, url)}
                  s={{ ...s.image, upload: s.groupImage }}
                  testId={`variant-group-image-${group.key}`}
                />
              </div>
              {!shut && group.indexes.map((i) =>
                rowControls(
                  i,
                  grouped.innerDefs
                    .map((d) => rows[i].options?.[d.name.trim()] ?? "")
                    .filter(Boolean)
                    .join(" / "),
                ),
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2">
        <button
          type="button"
          data-testid="variant-add-row"
          onClick={() =>
            setRows([...rows, { name: "", sku: "", stock: 0, threshold: 0, image: "", options: {} }])
          }
          className="ui-btn ui-btn-default ui-btn-sm tap"
        >
          {s.addVariant}
        </button>
      </div>
    </div>
  );
}
