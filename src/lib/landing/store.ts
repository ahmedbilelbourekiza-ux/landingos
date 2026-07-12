"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { LandingPageData, VariantGroup } from "@/types/landing";
import { groupVariants } from "./mock-data";
import { MOCK_SHIPPING_COST } from "./mock-data";

// Order state for a single landing page. Holds the user's variant selections
// and quantity; everything else (unit price, subtotal, shipping, total) is
// derived via selectors so there is a single source of truth. The sticky buy
// button, variant selectors, quantity stepper, and order summary all read
// from this store, which is why they stay in sync without prop drilling.

interface OrderState {
  // Map of variant group name → selected option value.
  selected: Record<string, string>;
  quantity: number;
  // Base unit price + flat shipping, captured at init so the store stays
  // self-contained for the template demo.
  basePrice: number;
  shipping: number;
  groups: VariantGroup[];
  select: (name: string, value: string) => void;
  setQuantity: (qty: number) => void;
}

// Computes the per-unit price including the extra price of every selected
// variant option. Falls back to the first option of each group when nothing
// is selected yet, so the displayed price always reflects a valid config.
function computeUnitPrice(
  groups: VariantGroup[],
  selected: Record<string, string>,
  basePrice: number,
): number {
  let extra = 0;
  for (const group of groups) {
    const chosen = selected[group.name] ?? group.options[0]?.value;
    const option = group.options.find((o) => o.value === chosen);
    if (option) extra += option.extraPrice;
  }
  return basePrice + extra;
}

export function createLandingOrderStore(page: LandingPageData) {
  const groups = groupVariants(page.variants);
  // Pre-select the first option of each group so the form starts in a valid,
  // fully-priced state rather than requiring the user to pick before a price
  // is shown.
  const initialSelected: Record<string, string> = {};
  for (const group of groups) {
    initialSelected[group.name] = group.options[0]?.value ?? "";
  }

  return create<OrderState>((set, get) => ({
    selected: initialSelected,
    quantity: 1,
    basePrice: page.price,
    shipping: MOCK_SHIPPING_COST,
    groups,
    select: (name, value) =>
      set((state) => ({ selected: { ...state.selected, [name]: value } })),
    setQuantity: (qty) => set({ quantity: Math.max(1, Math.min(99, qty)) }),
  }));
}

export type LandingOrderStore = ReturnType<typeof createLandingOrderStore>;

// Selectors — pure functions over state, used by components to read derived
// values without duplicating the math.
export function useUnitPrice(store: LandingOrderStore): number {
  return store((s) =>
    computeUnitPrice(s.groups, s.selected, s.basePrice),
  );
}

export function useOrderTotals(store: LandingOrderStore) {
  // The selector returns a new object each call, so without shallow equality
  // Zustand's default Object.is check would flag every render as a change and
  // trip React's useSyncExternalStore infinite-loop guard. useShallow compares
  // the returned object's values, not its reference.
  return store(
    useShallow((s) => {
      const unitPrice = computeUnitPrice(s.groups, s.selected, s.basePrice);
      const subtotal = unitPrice * s.quantity;
      const total = subtotal + s.shipping;
      return { unitPrice, subtotal, shipping: s.shipping, total };
    }),
  );
}
