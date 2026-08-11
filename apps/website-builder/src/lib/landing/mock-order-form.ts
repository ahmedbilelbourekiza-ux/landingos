// Order form field configuration. Each field controls how the purchase form
// renders on the public landing page: whether it's visible, required, and
// what label/placeholder to show. Notes and Quantity default to not visible
// (disabled) since they're optional form elements.

export interface OrderFormField {
  visible: boolean;
  required: boolean;
  label: string;
  placeholder: string;
}

export interface OrderFormConfig {
  customerName: OrderFormField;
  phone: OrderFormField;
  wilaya: OrderFormField;
  baladia: OrderFormField;
  address: OrderFormField;
  notes: OrderFormField;
  quantity: OrderFormField;
  // Render order of the fields above, top to bottom. Separate from the field
  // objects because order is a property of the form, not of any one field —
  // storing an index per field would let two fields claim the same position
  // and leave gaps when a field is removed.
  //
  // OPTIONAL ON PURPOSE. Configs saved before this existed have no `order`,
  // and normalizeOrder() fills it from the default. Any key missing from a
  // stored order is appended rather than dropped, so adding a field to
  // FIELD_DEFS later makes it appear at the end of every existing form
  // instead of vanishing.
  order?: FieldKey[];
  buttonText: string;
}

// Defaults describe what the storefront ACTUALLY RENDERS, which is why Notes
// and Quantity are visible here.
//
// They used to be false. That was harmless only because the public purchase
// form ignored this config entirely and hardcoded its fields — it always drew
// Notes and the quantity stepper regardless. Now that the form renders from
// this config, leaving them false would have silently removed both from every
// existing product the moment the change deployed. Address stays hidden
// because the live form genuinely does not collect it.
//
// Used as the fallback when a landing has no stored order-form config.
export const defaultOrderFormConfig: OrderFormConfig = {
  // Labels and placeholders are the Arabic strings the storefront was
  // hardcoding. They live here now that the form renders from this config —
  // had the English defaults been kept, wiring the config through would have
  // silently switched every existing product's checkout to English.
  customerName: {
    visible: true,
    required: true,
    label: "الاسم الكامل",
    placeholder: "أدخل اسمك الكامل",
  },
  phone: {
    visible: true,
    required: true,
    label: "رقم الهاتف",
    placeholder: "06 12 34 56 78",
  },
  wilaya: {
    visible: true,
    required: true,
    label: "الولاية",
    placeholder: "اختر الولاية...",
  },
  baladia: {
    visible: true,
    required: true,
    label: "البلدية",
    placeholder: "اختر البلدية...",
  },
  address: {
    visible: false,
    required: false,
    label: "العنوان",
    placeholder: "الشارع، العمارة، الطابق، الشقة",
  },
  notes: {
    visible: true,
    required: false,
    label: "ملاحظات الطلب (اختياري)",
    placeholder: "معلم، تفضيل وقت التوصيل...",
  },
  quantity: {
    visible: true,
    required: false,
    label: "الكمية",
    placeholder: "1",
  },
  // Matches the hardcoded top-to-bottom order the storefront rendered before
  // the form became configurable, so an untouched product looks identical.
  order: ["customerName", "phone", "wilaya", "baladia", "address", "notes", "quantity"],
  buttonText: "اطلب الآن",
};

// Metadata for each field — the CATALOGUE KEY for the name shown in the
// editor, and the key used to access the field in the config object.
//
// LB.13: this held `displayName: "Customer Name"` and friends, which put seven
// English sentences in a data module the editor rendered verbatim. A name a
// person reads is a key like every other one; the editor resolves it.
export const FIELD_DEFS = [
  { key: "customerName", nameKey: "builder.editor.fieldCustomerName" },
  { key: "phone", nameKey: "builder.editor.fieldPhone" },
  { key: "wilaya", nameKey: "builder.editor.fieldWilaya" },
  { key: "baladia", nameKey: "builder.editor.fieldBaladia" },
  { key: "address", nameKey: "builder.editor.fieldAddress" },
  { key: "notes", nameKey: "builder.editor.fieldNotes" },
  { key: "quantity", nameKey: "builder.editor.fieldQuantity" },
] as const;

export type FieldKey = (typeof FIELD_DEFS)[number]["key"];

export const ALL_FIELD_KEYS = FIELD_DEFS.map((f) => f.key) as readonly FieldKey[];

function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === "string" && (ALL_FIELD_KEYS as readonly string[]).includes(value);
}

// Turns a possibly-absent, possibly-stale stored order into a complete, valid
// one. Guarantees the result contains every known field exactly once.
//
// Four cases, all of which occur in practice:
//   - No stored order (config predates this feature) → the default order.
//   - A key that no longer exists (field removed from FIELD_DEFS) → dropped,
//     so a stale config cannot make the renderer look up a missing field.
//   - A known key missing from the stored order (field added later) → appended
//     in FIELD_DEFS order, so new fields surface instead of silently never
//     rendering.
//   - Duplicates → de-duplicated, keeping the first occurrence.
//
// Returning a complete list means every consumer can iterate it directly and
// none of them needs to re-derive this.
export function normalizeOrder(stored: unknown): FieldKey[] {
  const raw = Array.isArray(stored) ? stored : [];
  const seen = new Set<FieldKey>();
  const result: FieldKey[] = [];

  for (const key of raw) {
    if (isFieldKey(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  for (const key of ALL_FIELD_KEYS) {
    if (!seen.has(key)) result.push(key);
  }
  return result;
}
