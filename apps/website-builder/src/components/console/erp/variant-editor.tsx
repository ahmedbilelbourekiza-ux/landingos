"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * The variant editor — LP.18, restoring R12.
 *
 * A variant could be created once, in the product's `variants` array at
 * creation, and never renamed, never removed and never given a threshold — and
 * its stock could only be moved through the generic adjust control by typing the
 * variant name exactly right. `optionDefs` has had a column since Phase 3.2 with
 * no writer at all, so the vocabulary a matrix is built from could not be
 * stored.
 *
 * WHAT THE OPTION DEFINITIONS ARE FOR. "Size: S, M, L" and "Colour: Blue, Black"
 * is six variants, and typing six names by hand is how a catalogue ends up with
 * "M / Blue" and "Blue / M" as two separate rows holding separate stock. The
 * generator builds the cross product once, and every generated variant carries
 * its option MAP — which is what makes "how much Blue is left, in any size" a
 * question with an answer.
 *
 * D-06.3 STILL HOLDS, WITH ONE STATED EXCEPTION. The rows are local while being
 * edited, because a variant matrix is a form and not a switch — nothing is sent
 * until Save. Every number that comes BACK is the server's: the response is the
 * `inventoryView`, and the panel remounts on it.
 *
 * THE STOCK BOXES SHOW A LEVEL AND SEND A LEVEL, and the route turns each into a
 * DELTA against what is stored and applies it through `applyMovement`. That is
 * D-LP.18.1 and it is the whole reason this is a separate route rather than a
 * field on `PATCH /products/[id]`: a level written as a column is a level with
 * no movement row behind it, and the FIFO cost basis stops adding up.
 * ========================================================================== */

export interface VariantEditorStrings {
  readonly saving: string;
  readonly panel: string;
  readonly hint: string;
  readonly product: string;
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
  readonly reason: string;
  readonly save: string;
  readonly noVariants: string;
}

export interface EditableVariant {
  name: string;
  sku: string;
  stock: number;
  threshold: number;
  options: Record<string, string>;
}

export interface EditableProductVariants {
  readonly id: string;
  readonly label: string;
  readonly variants: readonly EditableVariant[];
  readonly optionDefs: readonly { name: string; values: string[] }[];
  /** What the server currently holds, so a save remounts the panel on it. */
  readonly fingerprint: string;
}

const FIELD = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm";

export function VariantEditorPanel({
  products,
  errors,
  s,
}: {
  readonly products: readonly EditableProductVariants[];
  readonly errors: ActionErrors;
  readonly s: VariantEditorStrings;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(products[0]?.id ?? "");

  if (!products.length) return null;
  const product = products.find((p) => p.id === selected) ?? products[0];

  return (
    <section className="mt-3 rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-variant-editor">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{s.panel}</h2>
        <ActionButton
          data-testid="variant-editor-toggle"
          aria-expanded={open}
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
        >
          {s.panel}
        </ActionButton>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>

      {/* D-06.4: rendered always, hidden when closed. */}
      <div hidden={!open}>
        <div className="mt-3">
          <label htmlFor="variant-product" className="ui-label block">
            {s.product}
          </label>
          <select
            id="variant-product"
            value={product.id}
            onChange={(e) => setSelected(e.target.value)}
            className={`mt-1 ${FIELD}`}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Remounted on the server's fingerprint, so a save brings back what was
            STORED rather than what was typed. */}
        <VariantRows
          key={`${product.id}:${product.fingerprint}`}
          product={product}
          errors={errors}
          s={s}
        />
      </div>
    </section>
  );
}

function VariantRows({
  product,
  errors,
  s,
}: {
  readonly product: EditableProductVariants;
  readonly errors: ActionErrors;
  readonly s: VariantEditorStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [rows, setRows] = useState<EditableVariant[]>(() => product.variants.map((v) => ({ ...v })));
  const [defs, setDefs] = useState(() => product.optionDefs.map((d) => ({ ...d, values: [...d.values] })));
  const [reason, setReason] = useState("");
  const [refused, setRefused] = useState<string[] | null>(null);

  const setRow = (i: number, patch: Partial<EditableVariant>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  /**
   * The cross product of every option definition.
   *
   * Rows that already exist are KEPT with their stock — a generator that
   * replaced the matrix would silently zero every level it regenerated, which
   * is a stock loss with no movement row and exactly what D-LP.18.1 forbids.
   * New combinations arrive at zero and take their opening stock as a movement
   * like everything else.
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
        // The name is the values joined, in definition order — stable, so
        // regenerating after adding a size does not rename everything.
        const name = usable.map((d) => options[d.name.trim()]).join(" / ");
        const existing = byName.get(name);
        return existing ?? { name, sku: "", stock: 0, threshold: 0, options };
      }),
    );
  };

  const save = async () => {
    setRefused(null);
    const { ok, data } = await run("PUT", `/api/erp/products/${product.id}/variants`, {
      variants: rows.map((r) => ({
        name: r.name.trim(),
        sku: r.sku,
        stock: r.stock,
        threshold: r.threshold,
        options: r.options,
      })),
      optionDefs: defs
        .filter((d) => d.name.trim() && d.values.filter(Boolean).length)
        .map((d) => ({ name: d.name.trim(), values: d.values.filter(Boolean) })),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    // The route refuses a removal that would drop stock and names every variant
    // it would have dropped — one at a time is four requests for four problems.
    if (!ok && data && typeof data === "object" && "variants" in (data as object)) {
      setRefused((data as { variants: string[] }).variants);
    }
  };

  return (
    <div className="mt-4">
      {/* The option definitions. */}
      <div className="space-y-2" data-testid="variant-options">
        {defs.map((def, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="ui-label block">{s.optionName}</label>
              <input
                data-testid={`option-name-${i}`}
                value={def.name}
                onChange={(e) =>
                  setDefs((d) => d.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                }
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <div className="flex-1">
              <label className="ui-label block">{s.optionValues}</label>
              <input
                data-testid={`option-values-${i}`}
                value={def.values.join(", ")}
                onChange={(e) =>
                  setDefs((d) =>
                    d.map((x, idx) =>
                      idx === i
                        ? { ...x, values: e.target.value.split(",").map((v) => v.trim()) }
                        : x,
                    ),
                  )
                }
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <button
              type="button"
              onClick={() => setDefs((d) => d.filter((_, idx) => idx !== i))}
              className="ui-btn ui-btn-default ui-btn-sm tap"
            >
              {s.remove}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="variant-add-option"
          onClick={() => setDefs((d) => [...d, { name: "", values: [] }])}
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
        <span className="self-center text-xs text-muted-foreground">{s.generateHint}</span>
      </div>

      {/* The matrix itself. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm" data-testid="variant-rows">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-start">{s.variant}</th>
              <th className="px-2 py-1 text-start">{s.sku}</th>
              <th className="px-2 py-1 text-end">{s.stock}</th>
              <th className="px-2 py-1 text-end">{s.threshold}</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-xs text-muted-foreground">
                  {s.noVariants}
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} data-variant-row={row.name}>
                <td className="px-2 py-1">
                  <input
                    data-testid={`variant-name-${i}`}
                    value={row.name}
                    onChange={(e) => setRow(i, { name: e.target.value })}
                    className={FIELD}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    data-testid={`variant-sku-${i}`}
                    value={row.sku}
                    onChange={(e) => setRow(i, { sku: e.target.value })}
                    className={FIELD}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    data-testid={`variant-stock-${i}`}
                    inputMode="numeric"
                    value={String(row.stock)}
                    onChange={(e) => setRow(i, { stock: Number(e.target.value) || 0 })}
                    className={`${FIELD} text-end`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    data-testid={`variant-threshold-${i}`}
                    inputMode="numeric"
                    value={String(row.threshold)}
                    onChange={(e) => setRow(i, { threshold: Number(e.target.value) || 0 })}
                    className={`${FIELD} text-end`}
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    data-testid={`variant-remove-${i}`}
                    onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                    className="ui-btn ui-btn-default ui-btn-sm tap"
                  >
                    {s.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <button
          type="button"
          data-testid="variant-add-row"
          onClick={() =>
            setRows((r) => [...r, { name: "", sku: "", stock: 0, threshold: 0, options: {} }])
          }
          className="ui-btn ui-btn-default ui-btn-sm tap"
        >
          {s.addVariant}
        </button>
        <div>
          {/* One reason for the whole batch, because the editor IS one action.
              It reaches every movement row this save writes. */}
          <label htmlFor="variant-reason" className="ui-label block">
            {s.reason}
          </label>
          <input
            id="variant-reason"
            data-testid="variant-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        <ActionButton
          data-testid="variant-save"
          pending={pending}
          pendingLabel={s.saving}
          onClick={() => void save()}
        >
          {s.save}
        </ActionButton>
      </div>

      {refused && (
        <p role="alert" data-testid="variant-refused" className="mt-2 text-xs text-destructive">
          {refused.join(", ")}
        </p>
      )}
      <ActionError message={error} />
    </div>
  );
}
