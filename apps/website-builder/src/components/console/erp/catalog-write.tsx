"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { EditField } from "@/components/console/edit-field";
import { ImageInput, type ImageInputStrings } from "./image-input";

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
 *
 * INV.3 NARROWED THAT SECOND RULE RATHER THAN BREAKING IT, and the distinction
 * is the whole design. There is now exactly ONE box that states a level
 * (`OpeningStockPanel`, at the foot of this file), and it exists only where
 * there is no history for an absolute figure to absorb: a level that has never
 * moved. It writes through the LOT route, so the opening figure arrives with a
 * cost basis like any other stock, and it vanishes the moment the first
 * movement is recorded. Everything after that is still a delta and a reason.
 * The rule the merchant met — "every box that says stock means add" — was the
 * bug; two boxes meaning opposite things WOULD have been the cure's own bug,
 * which is why only one of them can ever be on screen for a given level.
 * ========================================================================== */

/* One declaration, not a tenth hand-written copy of the text input. UX-14
   counted nine of these across the console and `styles.ts` replaced them; this
   file kept its own until PM.3, which is how a design system quietly acquires
   an exception. */
const FIELD = "ui-control tap w-full";

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
  /** INV.1 — the prompt that replaces `allVariants` on a variant product. */
  readonly chooseVariant: string;
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
  /* INV.3 — the one control that states a level rather than a change. */
  readonly openingPanel: string;
  readonly openingHint: string;
  readonly openingLevel: string;
  readonly setOpening: string;
  readonly image: ImageInputStrings;
}

/** A product the stockroom panels can act on, with its variant names. */
export interface StockProduct {
  readonly id: string;
  readonly name: string;
  readonly variants: readonly string[];
  /* INV.3 — the levels on this product that have NEVER moved, and may
   * therefore still be given an opening figure. A variant name, or "" for a
   * product that keeps a single unnamed level. Empty once everything has
   * moved, which is what makes the opening control disappear by itself. */
  readonly opening?: readonly string[];
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
          if (field.kind === "image") {
            return (
              <div key={field.name} className="sm:col-span-2">
                <ImageInput
                  value={form[field.name] ?? ""}
                  onChange={(next) => set(field.name, next)}
                  alt={form.name ?? ""}
                  s={{ ...s.image, label: field.label }}
                  testId="product-edit-image"
                />
              </div>
            );
          }
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

/**
 * INV.1 — has this request named the ONE level it is about?
 *
 * Both stockroom panels move exactly one level, and both routes behind them
 * now refuse a product-level movement against a product whose stock lives on
 * its variants. Written once, here, rather than twice inside two `usable`
 * expressions that would be free to drift apart — which is how the two panels
 * came to disagree about the blank value in the first place.
 *
 * A product with NO variants is unaffected: the blank value is the only level
 * it has, and it stays valid.
 */
function variantChosen(
  products: readonly StockProduct[],
  productId: string,
  variantName: string,
): boolean {
  const variants = products.find((p) => p.id === productId)?.variants ?? [];
  return variants.length === 0 || variantName !== "";
}

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
          {/* INV.1 — "All variants" was never a thing this control could do.
              Both routes behind it move ONE level, and against a product whose
              stock lives on its variants the blank value used to be accepted
              and silently move nothing (the movement was recorded anyway). The
              routes refuse it now, so the control stops offering it: on a
              variant product the blank option becomes an unselectable prompt,
              which is this file's own rule — "the control refuses it too rather
              than offering a button that 422s". A product with no variants
              keeps the blank value, because there it means the only level
              there is. */}
          <option value="" disabled={variants.length > 0}>
            {variants.length > 0 ? s.chooseVariant : s.allVariants}
          </option>
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
  // refuses it too rather than offering a button that 422s. INV.1 adds the
  // second half of the same rule: on a product whose stock lives on its
  // variants, a correction that names none is refused server-side, so the
  // button stays inert until one is chosen.
  const usable =
    productId && reason.trim() && Number.isFinite(n) && n !== 0 &&
    variantChosen(products, productId, variantName);

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
  // INV.1, the same rule as the correction panel above and for a sharper
  // reason: this route CREATES a lot, so a product-level restock on a variant
  // product used to leave a cost basis behind for units the stock column never
  // counted.
  const usable =
    productId && Number.isInteger(q) && q >= 1 && variantChosen(products, productId, variantName);

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

/* -----------------------------------------------------------------------------
 * INV.3 — the opening level
 * -------------------------------------------------------------------------- */

/**
 * Say what this stock IS, once, before anything has moved.
 *
 * THE COMPLAINT THIS ANSWERS, in the merchant's words: a landing page sent to
 * the Manager arrives with no stock, and typing the real quantity "behaves like
 * adding to an existing amount rather than setting an initial value". It did.
 * Every control this screen offered was additive, because every route it can
 * reach was — the two that accept an absolute level were both out of reach for
 * a freshly sent product (`POST /products` is not what the send uses, and the
 * variant editor needs variants the send does not transfer).
 *
 * SO THIS BOX IS THE ONE THAT SETS, AND IT IS THE ONLY ONE. Two boxes labelled
 * "stock" meaning opposite things is the confusion, not the cure, so this one
 * announces which it is in its own hint and appears ONLY where "set" is a
 * complete and honest statement: a level with no movement behind it. The
 * moment anything has moved, the level has a history that an absolute figure
 * would silently absorb, the control disappears, and corrections go through
 * the panel above them that records a reason.
 *
 * It writes through `/stock-lots`, not `/inventory/adjust`, and that is the
 * second half of the fix: opening stock is stock that ARRIVED, so it needs a
 * lot and a unit cost like any other arrival. The adjust route creates no lot
 * at all — which is why a level entered the obvious way had no cost basis and
 * made every margin computed from it wrong.
 */
export function OpeningStockPanel({
  errors,
  s,
  products,
}: {
  readonly errors: ActionErrors;
  readonly s: CatalogStrings;
  readonly products: readonly StockProduct[];
}) {
  const { run, pending, error } = useApiAction(errors);
  // Only products that still HAVE an unmoved level can be acted on here.
  const openable = products.filter((p) => (p.opening?.length ?? 0) > 0);
  const [productId, setProductId] = useState(openable[0]?.id ?? "");
  const [variantName, setVariantName] = useState("");
  const [level, setLevel] = useState("");
  const [unitCost, setUnitCost] = useState("");

  // The whole panel is absent once every level has moved — there is nothing
  // left it could honestly do, and an empty picker is a control that lies.
  if (!openable.length) return null;

  const product = openable.find((p) => p.id === productId) ?? openable[0];
  const levels = product.opening ?? [];
  // "" is the product's own level; a named level has to be chosen (INV.1).
  const namedLevels = levels.filter((l) => l !== "");
  const chosenLevel = namedLevels.length ? variantName : "";
  const n = Number(level);
  const usable =
    product.id &&
    Number.isInteger(n) &&
    n >= 1 &&
    (namedLevels.length === 0 || chosenLevel !== "");

  return (
    <section
      className="rounded-lg border border-border bg-surface-raised p-4"
      data-testid="erp-opening-panel"
    >
      <h2 className="text-sm font-semibold tracking-tight">{s.openingPanel}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{s.openingHint}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="opening-product" className="ui-label block">
            {s.product}
          </label>
          <select
            id="opening-product"
            value={product.id}
            onChange={(e) => {
              setProductId(e.target.value);
              setVariantName("");
            }}
            className={`mt-1 ${FIELD}`}
          >
            {openable.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="opening-variant" className="ui-label block">
            {s.variant}
          </label>
          <select
            id="opening-variant"
            value={chosenLevel}
            onChange={(e) => setVariantName(e.target.value)}
            // A product keeping one unnamed level has nothing to choose. Only
            // levels that have never moved are offered — the rest have a
            // history, and this control cannot honestly speak about those.
            disabled={namedLevels.length === 0}
            className={`mt-1 ${FIELD} disabled:opacity-50`}
          >
            <option value="" disabled={namedLevels.length > 0}>
              {namedLevels.length > 0 ? s.chooseVariant : s.allVariants}
            </option>
            {namedLevels.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="opening-level" className="ui-label block">
            {s.openingLevel}
          </label>
          <input
            id="opening-level" type="number" min={1} dir="ltr"
            value={level} onChange={(e) => setLevel(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>

        <div>
          <label htmlFor="opening-cost" className="ui-label block">
            {s.unitCost}
          </label>
          <input
            id="opening-cost" type="number" min={0} step="0.01" dir="ltr"
            value={unitCost} onChange={(e) => setUnitCost(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </div>
      </div>

      <div className="mt-4">
        <ActionButton
          data-testid="opening-submit"
          pending={pending}
          pendingLabel={s.saving}
          variant="primary"
          disabled={!usable}
          onClick={async () => {
            const { ok } = await run("POST", `/api/erp/products/${product.id}/stock-lots`, {
              // `setTo`, never `qty` — this box states the level, and the route
              // works out what has to arrive to reach it.
              setTo: n,
              ...(chosenLevel ? { variantName: chosenLevel } : {}),
              ...(unitCost.trim() ? { unitCost: unitCost.trim() } : {}),
            });
            if (ok) { setLevel(""); setUnitCost(""); }
          }}
        >
          {s.setOpening}
        </ActionButton>
      </div>

      <ActionError message={error} />
    </section>
  );
}
