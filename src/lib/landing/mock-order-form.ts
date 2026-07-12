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
  buttonText: string;
}

// The 5 core fields are always visible by default. Notes and Quantity are
// disabled (not visible) by default — the admin enables them when needed.
// Button text defaults to Arabic "اطلب الآن" (Order Now) per the task spec.
export const mockOrderFormData: OrderFormConfig = {
  customerName: {
    visible: true,
    required: true,
    label: "Full Name",
    placeholder: "Jane Doe",
  },
  phone: {
    visible: true,
    required: true,
    label: "Phone Number",
    placeholder: "+213 6 12 34 56 78",
  },
  wilaya: {
    visible: true,
    required: true,
    label: "Wilaya",
    placeholder: "Alger",
  },
  baladia: {
    visible: true,
    required: true,
    label: "Baladia",
    placeholder: "Bab El Oued",
  },
  address: {
    visible: false,
    required: false,
    label: "Address",
    placeholder: "Street, building, floor, apartment",
  },
  notes: {
    visible: false,
    required: false,
    label: "Order Notes",
    placeholder: "Landmark, delivery time preference…",
  },
  quantity: {
    visible: false,
    required: false,
    label: "Quantity",
    placeholder: "1",
  },
  buttonText: "اطلب الآن",
};

// Metadata for each field — the display name shown in the editor and the
// key used to access the field in the config object.
export const FIELD_DEFS = [
  { key: "customerName", displayName: "Customer Name" },
  { key: "phone", displayName: "Phone Number" },
  { key: "wilaya", displayName: "Wilaya" },
  { key: "baladia", displayName: "Baladia" },
  { key: "address", displayName: "Address" },
  { key: "notes", displayName: "Notes" },
  { key: "quantity", displayName: "Quantity" },
] as const;

export type FieldKey = (typeof FIELD_DEFS)[number]["key"];
