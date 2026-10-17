"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { LandingPageData, VariantGroup } from "@/types/landing";
import { groupVariants } from "./mock-data";
import { unitPriceNumber } from "./variant-price";

// Order state for a single landing page. Holds the user's variant selections
// and quantity; unit price and subtotal are derived via selectors. Shipping
// is NOT in this store — it depends on the customer's selected wilaya, which
// is selected in the PurchaseForm. The PurchaseForm owns shipping + total.

interface OrderState {
  selected: Record<string, string>;
  quantity: number;
  basePrice: number;
  groups: VariantGroup[];
  /** VAR.2 — level per catalogue name, or null when nothing is enforced. */
  stockByVariant: Readonly<Record<string, number>> | null;
  select: (name: string, value: string) => void;
  setQuantity: (qty: number) => void;
}

function computeUnitPrice(
  groups: VariantGroup[],
  selected: Record<string, string>,
  basePrice: number,
): number {
  // Groups are in display order, so the selection is too — the order the
  // checkout resolves an own price in (VP.1).
  const chosen: VariantGroup["options"] = [];
  for (const group of groups) {
    const value = selected[group.name] ?? group.options[0]?.value;
    const option = group.options.find((o) => o.value === value);
    if (option) chosen.push(option);
  }
  return unitPriceNumber(basePrice, chosen);
}

export function createLandingOrderStore(page: LandingPageData) {
  const groups = groupVariants(page.variants);
  /* VAR.2 — the levels this page sells against, or null when the merchant has
   * not turned enforcement on. Null and "linked to nothing" are the same
   * answer on purpose: sell freely. Carried on the order store because the
   * selectors already read their groups and selection from here, and the
   * availability of an option is a fact about that same selection. */
  const stockByVariant = page.stockByVariant ?? null;
  const initialSelected: Record<string, string> = {};
  for (const group of groups) {
    initialSelected[group.name] = group.options[0]?.value ?? "";
  }

  return create<OrderState>((set) => ({
    selected: initialSelected,
    quantity: 1,
    basePrice: page.price,
    groups,
    stockByVariant,
    select: (name, value) =>
      set((state) => ({ selected: { ...state.selected, [name]: value } })),
    setQuantity: (qty) => set({ quantity: Math.max(1, Math.min(99, qty)) }),
  }));
}

export type LandingOrderStore = ReturnType<typeof createLandingOrderStore>;

export function useUnitPrice(store: LandingOrderStore): number {
  return store((s) =>
    computeUnitPrice(s.groups, s.selected, s.basePrice),
  );
}

// Returns unit price + subtotal only. Shipping and total are NOT here —
// they depend on the selected wilaya and are computed in PurchaseForm.
export function useOrderTotals(store: LandingOrderStore) {
  return store(
    useShallow((s) => {
      const unitPrice = computeUnitPrice(s.groups, s.selected, s.basePrice);
      const subtotal = unitPrice * s.quantity;
      return { unitPrice, subtotal };
    }),
  );
}
