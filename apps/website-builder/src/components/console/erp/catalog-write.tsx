"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { EditField } from "@/components/console/edit-field";

/* =============================================================================
 * The catalogue's and the stockroom's write controls — Phase 6.3c.
 *
 * Two rules from the API surface show through every panel here, and both are
 * the design rather than an implementation detail:
 *
 * ARCHIVE, NEVER DELETE. A product is referenced by every order that ever
 * contained it, by its movement ledger and by its event timeline. `DELETE
 * /products/[id]` sets a flag; the button says "archive" because that is what
 * happens, and the archived view offers the other half rather than pretending
 * the row is gone.
 *
 * STOCK MOVES BY A DELTA AND A REASON, never to an absolute figure. "Stock is
 * 15" tells nobody anything; "20 → 15, five damaged, recorded by this person" is
 * auditable. `POST /inventory/adjust` offers no way to set a total, so neither
 * does this — a box labelled "new quantity" would be a control the API cannot
 * honour.
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface CatalogStrings {
  readonly saving: string;
  readonly save: string;
  readonly newProduct: string;
  readonly name: string;
  readonly sku: string;
  readonly brand: string;
  readonly price: string;
  readonly cost: string;
  readonly packaging: string;
  readonly threshold: string;
  readonly stock: string;
  readonly create: string;
  readonly editProduct: string;
  readonly apply: string;
  readonly cancel: string;
  readonly description: string;
  readonly archive: string;
  readonly restore: string;
  readonly adjustPanel: string;
  readonly adjustHint: string;
  readonly product: string;
  readonly variant: string;
  readonly allVariants: string;
  readonly change: string;
  readonly reason: string;
  readonly adjust: string;
  readonly lotPanel: string;
  readonly lotHint: string;
  readonly mode: string;
  readonly purchase: string;
  readonly restock: string;
  readonly quantity: string;
  readonly unitCost: string;
  readonly addLot: string;
}

/** A product the stockroom panels can act on, with its variant names. */
export interface StockProduct {
  readonly id: string;
  readonly name: string;
  readonly variants: readonly string[];
}

/* -----------------------------------------------------------------------------
 * A new product
 * -------------------------------------------------------------------------- */

export function ProductCreatePanel({
  errors,
  s,
}: {
  readonly errors: ActionErrors;
  readonly s: CatalogStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", sku: "", brand: "",
    price: "", costPrice: "", packagingCost: "",
    threshold: "", stock: "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const money = (id: keyof typeof form, label: string) => (
    <div>
      <label htmlFor={`new-${id}`} className="ui-label block">{label}</label>
      {/* Text with a decimal keypad, never type="number" — a number input hands
          back a JS float and these are Decimal columns (M-06). */}
      <input
        id={`new-${id}`} inputMode="decimal" dir="ltr"
        value={form[id]} onChange={(e) => set(id, e.target.value)} className={`mt-1 ${FIELD}`}
      />
    </div>
  );

  const whole = (id: keyof typeof form, label: string) => (
    <div>
      <label htmlFor={`new-${id}`} className="ui-label block">{label}</label>
      <input
        id={`new-${id}`} type="number" min={0} dir="ltr"
        value={form[id]} onChange={(e) => set(id, e.target.value)} className={`mt-1 ${FIELD}`}
      />
    </div>
  );

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-product-create">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{s.newProduct}</h2>
        <ActionButton
          data-testid="product-create-toggle"
          aria-expanded={open}
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? s.save : s.newProduct}
        </ActionButton>
      </div>

      {open && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="new-name" className="ui-label block">
                {s.name}
              </label>
              <input
                id="new-name" required
                value={form.name} onChange={(e) => set("name", e.target.value)}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <div>
              <label htmlFor="new-sku" className="ui-label block">{s.sku}</label>
              <input
                id="new-sku" dir="ltr"
                value={form.sku} onChange={(e) => set("sku", e.target.value)}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <div>
              <label htmlFor="new-brand" className="ui-label block">
                {s.brand}
              </label>
              <input
                id="new-brand"
                value={form.brand} onChange={(e) => set("brand", e.target.value)}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            {money("price", s.price)}
            {/* Both cost fields are offered, and that is not padding: an earlier
                version of the create route dropped them, nothing failed, and the
                product simply appeared with a zero cost basis — which makes every
                profit figure derived from it wrong rather than absent. */}
            {money("costPrice", s.cost)}
            {money("packagingCost", s.packaging)}
            {whole("stock", s.stock)}
            {whole("threshold", s.threshold)}
          </div>

          <div className="mt-4">
            <ActionButton
              data-testid="product-create-submit"
              pending={pending}
              pendingLabel={s.saving}
              variant="primary"
              disabled={!form.name.trim()}
              onClick={async () => {
                const { ok } = await run("POST", "/api/erp/products", {
                  name: form.name.trim(),
                  ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
                  ...(form.brand.trim() ? { brand: form.brand.trim() } : {}),
                  ...(form.price.trim() ? { price: form.price.trim() } : {}),
                  ...(form.costPrice.trim() ? { costPrice: form.costPrice.trim() } : {}),
                  ...(form.packagingCost.trim()
                    ? { packagingCost: form.packagingCost.trim() }
                    : {}),
                  ...(form.stock.trim() ? { stock: form.stock.trim() } : {}),
                  ...(form.threshold.trim() ? { threshold: form.threshold.trim() } : {}),
                });
                if (ok) {
                  setForm({
                    name: "", sku: "", brand: "",
                    price: "", costPrice: "", packagingCost: "",
                    threshold: "", stock: "",
                  });
                  setOpen(false);
                }
              }}
            >
              {s.create}
            </ActionButton>
          </div>

          <ActionError message={error} />
        </>
      )}
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * Correcting a product
 * -------------------------------------------------------------------------- */

/** One product the edit panel can act on, described by the server. */
export interface EditableProduct {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly EditField[];
  /** `editFingerprint(fields)` — what the server currently holds. */
  readonly fingerprint: string;
}

/**
 * The fields for ONE product, remounted whenever the server's values change.
 *
 * Split out so the `key` can carry the fingerprint (D-06.3) without also
 * resetting the product selector above it — a save refreshes the page, the
 * fingerprint changes, and these boxes come back holding what was STORED rather
 * than what was typed. `buildProductPatch` trims and normalises, so the two are
 * not always the same string.
 */
function ProductEditFields({
  product,
  errors,
  s,
}: {
  readonly product: EditableProduct;
  readonly errors: ActionErrors;
  readonly s: CatalogStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.fields.map((f) => [f.name, f.value])),
  );

  const set = (name: string, value: string) => setForm((f) => ({ ...f, [name]: value }));

  return (
    <>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {product.fields.map((field) => {
          const id = `edit-${field.name}`;
          return (
            <div key={field.name} className={field.kind === "textarea" ? "sm:col-span-2 lg:col-span-4" : ""}>
              <label htmlFor={id} className="ui-label block">
                {field.label}
              </label>
              {field.kind === "textarea" ? (
                <textarea
                  id={id} name={field.name} rows={2}
                  value={form[field.name] ?? ""}
                  onChange={(e) => set(field.name, e.target.value)}
                  className={`mt-1 ${FIELD}`}
                />
              ) : (
                <input
                  id={id} name={field.name}
                  // Money is text with a decimal keypad, never type="number" — a
                  // number input hands back a JS float and these are Decimal
                  // columns (M-06). A whole count is safe as a number input.
                  {...(field.kind === "money"
                    ? { inputMode: "decimal" as const, dir: "ltr" as const }
                    : field.kind === "number"
                      ? { type: "number", min: 0, dir: "ltr" as const }
                      : {})}
                  value={form[field.name] ?? ""}
                  onChange={(e) => set(field.name, e.target.value)}
                  className={`mt-1 ${FIELD}`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="product-edit-submit"
          data-product-id={product.id}
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          disabled={!(form.name ?? "").trim()}
          onClick={() => void run("PATCH", `/api/erp/products/${product.id}`, form)}
        >
          {s.apply}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </>
  );
}

/**
 * Correct a product that already exists.
 *
 * The ERP had this and the port lost it, so until now a product could be
 * created and archived and never fixed — and `costPrice` is the basis every
 * profit figure is computed from. See `lib/erp/catalog.ts`.
 *
 * `stock` is NOT offered, and its absence is the point: a level moves through
 * the stockroom panels below, which write a movement row saying why. A box here
 * would set a number with no reason behind it. `image` and the variant list are
 * absent too — both need their own surface, and a control the API cannot
 * honour is worse than a missing one.
 */
export function ProductEditPanel({
  products,
  errors,
  s,
}: {
  readonly products: readonly EditableProduct[];
  readonly errors: ActionErrors;
  readonly s: CatalogStrings;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(products[0]?.id ?? "");

  if (!products.length) return null;
  const product = products.find((p) => p.id === selected) ?? products[0];

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-product-edit">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{s.editProduct}</h2>
        <ActionButton
          data-testid="product-edit-toggle"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? s.cancel : s.editProduct}
        </ActionButton>
      </div>

      {/* D-06.4: rendered always, hidden when closed. Mounting on click means
          the offered vocabulary only exists after JavaScript runs, which no
          contract test can assert and no screen reader can reach. */}
      <div hidden={!open}>
        <div className="mt-3">
          <label htmlFor="edit-product" className="ui-label block">
            {s.product}
          </label>
          <select
            id="edit-product"
            value={product.id}
            onChange={(e) => setSelected(e.target.value)}
            className={`mt-1 ${FIELD}`}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <ProductEditFields
          key={`${product.id}:${product.fingerprint}`}
          product={product}
          errors={errors}
          s={s}
        />
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * Archive, and the other half of it
 * -------------------------------------------------------------------------- */

export function ProductRowActions({
  productId,
  archived,
  errors,
  s,
}: {
  readonly productId: string;
  readonly archived: boolean;
  readonly errors: ActionErrors;
  readonly s: CatalogStrings;
}) {
  const { run, pending, error } = useApiAction(errors);

  return (
    <>
      <ActionButton
        data-testid={archived ? "product-restore" : "product-archive"}
        data-product-id={productId}
        pending={pending}
        pendingLabel={s.saving}
        onClick={() =>
          void (archived
            ? run("POST", `/api/erp/products/${productId}/unarchive`)
            : run("DELETE", `/api/erp/products/${productId}`))
        }
      >
        {archived ? s.restore : s.archive}
      </ActionButton>
      <ActionError message={error} />
    </>
  );
}

/* -----------------------------------------------------------------------------
 * The stockroom
 * -------------------------------------------------------------------------- */

function ProductPicker({
  products,
  productId,
  variantName,
  onProduct,
  onVariant,
  s,
  idPrefix,
}: {
  readonly products: readonly StockProduct[];
  readonly productId: string;
  readonly variantName: string;
  readonly onProduct: (v: string) => void;
  readonly onVariant: (v: string) => void;
  readonly s: CatalogStrings;
  readonly idPrefix: string;
}) {
  const variants = products.find((p) => p.id === productId)?.variants ?? [];

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-product`} className="ui-label block">
          {s.product}
        </label>
        <select
          id={`${idPrefix}-product`}
          value={productId}
          onChange={(e) => {
            onProduct(e.target.value);
            // The variant belongs to the product. Carrying the old name over
            // would send a variant this product does not have, and the route
            // answers 404 for it.
            onVariant("");
          }}
          className={`mt-1 ${FIELD}`}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-variant`} className="ui-label block">
          {s.variant}
        </label>
        <select
          id={`${idPrefix}-variant`}
          value={variantName}
          onChange={(e) => onVariant(e.target.value)}
          // A product with no variants has nothing to choose, and a select with
          // one disabled option is a control that cannot do anything.
          disabled={variants.length === 0}
          className={`mt-1 ${FIELD} disabled:opacity-50`}
        >
          <option value="">{s.allVariants}</option>
          {variants.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
    </>
  );
}

export function StockAdjustPanel({
  errors,
  s,
  products,
}: {
  readonly errors: ActionErrors;
  readonly s: CatalogStrings;
  readonly products: readonly StockProduct[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [variantName, setVariantName] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const n = Number(delta);
  // The route refuses a zero adjustment — it records nothing — so the control
  // refuses it too rather than offering a button that 422s.
  const usable = productId && reason.trim() && Number.isFinite(n) && n !== 0;

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-adjust-panel">
      <h2 className="text-sm font-semibold tracking-tight">{s.adjustPanel}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{s.adjustHint}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ProductPicker
          idPrefix="adjust"
          products={products}
          productId={productId}
          variantName={variantName}
          onProduct={setProductId}
          onVariant={setVariantName}
          s={s}
        />
        <div>
          <label htmlFor="adjust-delta" className="ui-label block">
            {s.change}
          </label>
          {/* Signed, and no absolute figure anywhere on this panel. */}
          <input
            id="adjust-delta" type="number" dir="ltr"
            value={delta} onChange={(e) => setDelta(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        <div>
          <label htmlFor="adjust-reason" className="ui-label block">
            {s.reason}
          </label>
          <input
            id="adjust-reason" required
            value={reason} onChange={(e) => setReason(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="adjust-submit"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          disabled={!usable}
          onClick={async () => {
            const { ok } = await run(
              "POST",
              `/api/erp/products/${productId}/inventory/adjust`,
              {
                delta: n,
                reason: reason.trim(),
                ...(variantName ? { variantName } : {}),
              },
            );
            if (ok) { setDelta(""); setReason(""); }
          }}
        >
          {s.adjust}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}

export function StockLotPanel({
  errors,
  s,
  products,
}: {
  readonly errors: ActionErrors;
  readonly s: CatalogStrings;
  readonly products: readonly StockProduct[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [variantName, setVariantName] = useState("");
  const [mode, setMode] = useState<"purchase" | "return">("purchase");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const q = Number(qty);
  const usable = productId && Number.isInteger(q) && q >= 1;

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-lot-panel">
      <h2 className="text-sm font-semibold tracking-tight">{s.lotPanel}</h2>
      {/* Why a lot exists at all, said where somebody is about to create one. */}
      <p className="mt-1 text-xs text-muted-foreground">{s.lotHint}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <ProductPicker
          idPrefix="lot"
          products={products}
          productId={productId}
          variantName={variantName}
          onProduct={setProductId}
          onVariant={setVariantName}
          s={s}
        />
        <div>
          <label htmlFor="lot-mode" className="ui-label block">{s.mode}</label>
          <select
            id="lot-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "purchase" | "return")}
            className={`mt-1 ${FIELD}`}
          >
            <option value="purchase">{s.purchase}</option>
            <option value="return">{s.restock}</option>
          </select>
        </div>
        <div>
          <label htmlFor="lot-qty" className="ui-label block">
            {s.quantity}
          </label>
          <input
            id="lot-qty" type="number" min={1} dir="ltr"
            value={qty} onChange={(e) => setQty(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
        {/* A RETURN carries no new price — it rejoins stock at the product's
            existing cost basis rather than inventing a purchase that never
            happened — so the field is not offered for one. */}
        {mode === "purchase" && (
          <div>
            <label htmlFor="lot-unit-cost" className="ui-label block">
              {s.unitCost}
            </label>
            <input
              id="lot-unit-cost" inputMode="decimal" dir="ltr"
              value={unitCost} onChange={(e) => setUnitCost(e.target.value)}
              className={`mt-1 ${FIELD}`}
            />
          </div>
        )}
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="lot-submit"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          disabled={!usable}
          onClick={async () => {
            const { ok } = await run("POST", `/api/erp/products/${productId}/stock-lots`, {
              mode,
              qty: q,
              ...(variantName ? { variantName } : {}),
              ...(mode === "purchase" && unitCost.trim() ? { unitCost: unitCost.trim() } : {}),
            });
            if (ok) { setQty(""); setUnitCost(""); }
          }}
        >
          {s.addLot}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}
