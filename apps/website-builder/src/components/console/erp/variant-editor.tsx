"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { Section } from "@/components/console/ui/primitives";
import * as s2 from "@/components/console/ui/styles";
import {
  VariantMatrix,
  type VariantRow,
  type OptionDef,
  type VariantMatrixStrings,
} from "./variant-matrix";

/* =============================================================================
 * The variant editor — LP.18 (R12), rebuilt on the shared matrix in PM.3.
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
 * PM.3 MOVED THE GRID ITSELF INTO `variant-matrix.tsx`, for a reason that is
 * about workflow rather than tidiness: the same matrix now appears while
 * CREATING a product, so a manager enters a product and its fifteen variants in
 * one pass instead of creating a bare product, finding it in a picker, and
 * opening a second panel. One editor, two callers, one behaviour.
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

export interface VariantEditorStrings extends VariantMatrixStrings {
  readonly saving: string;
  readonly panel: string;
  readonly hint: string;
  readonly product: string;
  readonly reason: string;
  readonly save: string;
  readonly open: string;
  readonly close: string;
}

export interface EditableVariant {
  name: string;
  sku: string;
  stock: number;
  threshold: number;
  image: string;
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
    <Section
      testId="erp-variant-editor"
      title={s.panel}
      description={s.hint}
      actions={
        <ActionButton
          data-testid="variant-editor-toggle"
          aria-expanded={open}
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? s.close : s.open}
        </ActionButton>
      }
    >
      {/* D-06.4: rendered always, hidden when closed — so a contract test can
          assert the offered vocabulary and assistive tech can reach it before
          anybody clicks. */}
      <div hidden={!open}>
        <div className="max-w-sm">
          <label htmlFor="variant-product" className={s2.fieldLabel + " block"}>
            {s.product}
          </label>
          <select
            id="variant-product"
            value={product.id}
            onChange={(e) => setSelected(e.target.value)}
            className="ui-control tap mt-1 w-full"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
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
    </Section>
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
  const [rows, setRows] = useState<VariantRow[]>(() =>
    product.variants.map((v) => ({ ...v, image: v.image ?? "" })),
  );
  const [defs, setDefs] = useState<OptionDef[]>(() =>
    product.optionDefs.map((d) => ({ ...d, values: [...d.values] })),
  );
  const [reason, setReason] = useState("");
  const [refused, setRefused] = useState<string[] | null>(null);

  const save = async () => {
    setRefused(null);
    const { ok, data } = await run("PUT", `/api/erp/products/${product.id}/variants`, {
      variants: rows.map((r) => ({
        name: r.name.trim(),
        sku: r.sku,
        stock: r.stock,
        threshold: r.threshold,
        // PM.2 — the photograph is sent with the row it belongs to. The route
        // has accepted it since LP.18 and no control has ever produced one.
        image: r.image,
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
      <VariantMatrix rows={rows} setRows={setRows} defs={defs} setDefs={setDefs} s={s} />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          {/* One reason for the whole batch, because the editor IS one action.
              It reaches every movement row this save writes. */}
          <label htmlFor="variant-reason" className={s2.fieldLabel + " block"}>
            {s.reason}
          </label>
          <input
            id="variant-reason"
            data-testid="variant-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="ui-control tap mt-1 w-full"
          />
        </div>
        <ActionButton
          data-testid="variant-save"
          variant="primary"
          pending={pending}
          pendingLabel={s.saving}
          onClick={() => void save()}
        >
          {s.save}
        </ActionButton>
      </div>

      {refused && (
        <p role="alert" data-testid="variant-refused" className="mt-2 text-xs font-medium text-(--danger-fg)">
          {refused.join(", ")}
        </p>
      )}
      <ActionError message={error} />
    </div>
  );
}
