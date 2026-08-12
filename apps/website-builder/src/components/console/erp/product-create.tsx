"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { Section, Field, fieldAria } from "@/components/console/ui/primitives";
import { ImageInput, type ImageInputStrings } from "./image-input";
import {
  VariantMatrix,
  type VariantRow,
  type OptionDef,
  type VariantMatrixStrings,
} from "./variant-matrix";

/* =============================================================================
 * A new product, in ONE pass — PM.3.
 *
 * WHAT IT REPLACES, AND WHY THAT WAS THE REAL COST. Adding a catalogue product
 * with fifteen variants took three screens' worth of work through two panels
 * that did not know about each other:
 *
 *   1. open "New product", type a name and the money, save;
 *   2. find the product again in the EDIT panel's picker to fill in the
 *      classification fields — which the create panel did not offer at all,
 *      although `POST /api/erp/products` has accepted `niche`, `category` and
 *      `supplier` since LP.18;
 *   3. find it a THIRD time in the variant editor's picker to add the variants
 *      — although the same POST accepts a whole `variants` array.
 *
 * So the API could always take a complete product in one request and the
 * console insisted on three. Nothing here widens what the endpoint accepts;
 * this offers what it already did.
 *
 * D-06.4 — the contents render always and are toggled with `hidden`. The panel
 * this replaces used `{open && …}`, which mounts on click: the offered
 * vocabulary then only exists after JavaScript runs, so no contract test can
 * assert it and no screen reader can reach it until somebody clicks. That was a
 * live violation of a rule this project wrote down, in the panel a manager uses
 * most.
 *
 * D-06.1 — it calls `POST /api/erp/products`. One request, one transaction, one
 * set of contract tests in front of it.
 * ========================================================================== */

export interface ProductCreateStrings extends VariantMatrixStrings {
  readonly saving: string;
  readonly newProduct: string;
  readonly open: string;
  readonly close: string;
  readonly create: string;
  readonly identity: string;
  readonly classification: string;
  readonly money: string;
  readonly stockSection: string;
  readonly variantsSection: string;
  readonly variantsHint: string;
  readonly name: string;
  readonly sku: string;
  readonly brand: string;
  readonly niche: string;
  readonly category: string;
  readonly supplier: string;
  readonly price: string;
  readonly cost: string;
  readonly packaging: string;
  readonly costHint: string;
  readonly thresholdHint: string;
  readonly stockHint: string;
  readonly imageStrings: ImageInputStrings;
  readonly required: string;
}

const EMPTY = {
  name: "",
  sku: "",
  brand: "",
  niche: "",
  category: "",
  supplier: "",
  description: "",
  price: "",
  costPrice: "",
  packagingCost: "",
  threshold: "",
  stock: "",
  image: "",
};

export function ProductCreatePanel({
  errors,
  s,
  categories = [],
  niches = [],
}: {
  readonly errors: ActionErrors;
  readonly s: ProductCreateStrings;
  /**
   * LB.19 — the classification values this catalogue already uses.
   *
   * Passed in from the server rather than fetched here: the screen has already
   * read them for its own filter, and a second round trip from the browser for
   * a list the page is holding would be a second answer to one question.
   */
  readonly categories?: readonly string[];
  readonly niches?: readonly string[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [defs, setDefs] = useState<OptionDef[]>([]);

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const text = (id: keyof typeof EMPTY, label: string, opts: {
    required?: boolean; ltr?: boolean; help?: string; className?: string;
    /** LB.19 — values already in use, offered as suggestions. */
    suggestions?: readonly string[];
  } = {}) => (
    <Field
      id={`new-${id}`}
      label={label}
      required={opts.required}
      help={opts.help}
      className={opts.className}
    >
      <input
        {...fieldAria(`new-${id}`, { required: opts.required, help: Boolean(opts.help) })}
        {...(opts.ltr ? { dir: "ltr" as const } : {})}
        /* A `datalist`, not a `select`. The column is free text by an explicit
           schema decision, and the merchant must still be able to name a
           category that does not exist yet — the FIRST product in a category
           has to create it. This suggests without forbidding, which is the
           whole of the fix: the gap was never "no categories", it was that
           nothing showed which ones were already in use, so "Skincare",
           "skincare" and "Skin care" became three. */
        {...(opts.suggestions?.length ? { list: `new-${id}-options` } : {})}
        value={form[id]}
        onChange={(e) => set(id, e.target.value)}
        className="ui-control tap w-full"
      />
      {opts.suggestions?.length ? (
        <datalist id={`new-${id}-options`}>
          {opts.suggestions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ) : null}
    </Field>
  );

  /* Money is text with a decimal keypad, never `type="number"` — a number input
     hands back a JS float and these are `Decimal` columns (M-06). */
  const money = (id: keyof typeof EMPTY, label: string, help?: string) => (
    <Field id={`new-${id}`} label={label} help={help}>
      <input
        {...fieldAria(`new-${id}`, { help: Boolean(help) })}
        inputMode="decimal"
        dir="ltr"
        value={form[id]}
        onChange={(e) => set(id, e.target.value)}
        className="ui-control tap w-full text-end"
      />
    </Field>
  );

  const whole = (id: keyof typeof EMPTY, label: string, help?: string) => (
    <Field id={`new-${id}`} label={label} help={help}>
      <input
        {...fieldAria(`new-${id}`, { help: Boolean(help) })}
        type="number"
        min={0}
        dir="ltr"
        value={form[id]}
        onChange={(e) => set(id, e.target.value)}
        className="ui-control tap w-full text-end"
      />
    </Field>
  );

  const submit = async () => {
    const named = rows.filter((r) => r.name.trim());
    const { ok } = await run("POST", "/api/erp/products", {
      name: form.name.trim(),
      ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
      ...(form.brand.trim() ? { brand: form.brand.trim() } : {}),
      ...(form.niche.trim() ? { niche: form.niche.trim() } : {}),
      ...(form.category.trim() ? { category: form.category.trim() } : {}),
      ...(form.supplier.trim() ? { supplier: form.supplier.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.price.trim() ? { price: form.price.trim() } : {}),
      ...(form.costPrice.trim() ? { costPrice: form.costPrice.trim() } : {}),
      ...(form.packagingCost.trim() ? { packagingCost: form.packagingCost.trim() } : {}),
      ...(form.stock.trim() ? { stock: form.stock.trim() } : {}),
      ...(form.threshold.trim() ? { threshold: form.threshold.trim() } : {}),
      ...(form.image.trim() ? { image: form.image.trim() } : {}),
      /* The array the route has accepted since Phase 5 and no control has ever
         sent. `stock` on a variant is an OPENING level here — the product does
         not exist yet, so there is no movement to record a delta against, which
         is why creation is the one place a level may be stated directly. */
      ...(named.length
        ? {
            variants: named.map((r) => ({
              name: r.name.trim(),
              ...(r.sku.trim() ? { sku: r.sku.trim() } : {}),
              stock: r.stock,
              threshold: r.threshold,
              ...(r.image.trim() ? { image: r.image.trim() } : {}),
            })),
          }
        : {}),
    });
    if (ok) {
      setForm({ ...EMPTY });
      setRows([]);
      setDefs([]);
      setOpen(false);
    }
  };

  return (
    <Section
      testId="erp-product-create"
      title={s.newProduct}
      actions={
        <ActionButton
          data-testid="product-create-toggle"
          aria-expanded={open}
          pending={false}
          pendingLabel={s.saving}
          variant={open ? "default" : "primary"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? s.close : s.open}
        </ActionButton>
      }
    >
      <div hidden={!open} className="space-y-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {s.identity}
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {text("name", s.name, { required: true, className: "sm:col-span-2" })}
            {text("sku", s.sku, { ltr: true })}
            {text("brand", s.brand)}
          </div>
          <div className="mt-3">
            {/* PM.2 — the product's own photograph, used wherever a variant has
                none of its own. The column has existed since M-06 and this is
                the first control that can put a FILE into it. */}
            <ImageInput
              value={form.image}
              onChange={(image) => set("image", image)}
              alt={form.name}
              s={s.imageStrings}
              testId="product-create-image"
            />
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {s.classification}
          </h3>
          {/* LP.18's three columns, offered at CREATION for the first time.
              `niche` is the load-bearing one: the customer registry filters by
              it and one analytics breakdown groups by it, so a catalogue built
              without it makes both uncomputable. */}
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {text("niche", s.niche, { suggestions: niches })}
            {text("category", s.category, { suggestions: categories })}
            {text("supplier", s.supplier)}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {s.money}
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {money("price", s.price)}
            {/* Both cost fields are offered, and that is not padding: an earlier
                version of the create route dropped them, nothing failed, and the
                product appeared with a zero cost basis — which makes every
                profit figure derived from it wrong rather than absent. */}
            {money("costPrice", s.cost, s.costHint)}
            {money("packagingCost", s.packaging)}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {s.stockSection}
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {whole("stock", s.stock, s.stockHint)}
            {whole("threshold", s.threshold, s.thresholdHint)}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {s.variantsSection}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{s.variantsHint}</p>
          <div className="mt-2">
            <VariantMatrix
              rows={rows}
              setRows={setRows}
              defs={defs}
              setDefs={setDefs}
              s={s}
              testId="product-create-variants"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            data-testid="product-create-submit"
            pending={pending}
            pendingLabel={s.saving}
            variant="primary"
            disabled={!form.name.trim()}
            onClick={() => void submit()}
          >
            {s.create}
          </ActionButton>
          {!form.name.trim() && (
            <span className="text-xs text-muted-foreground">{s.required}</span>
          )}
        </div>

        <ActionError message={error} />
      </div>
    </Section>
  );
}
