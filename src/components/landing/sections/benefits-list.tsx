import { Truck, Wallet, ShieldCheck, Award } from "lucide-react";

// Trust badges: universal COD conversion signals that appear under the price.
// These are intentionally hardcoded rather than data-driven — they are
// business-model constants (fast delivery, cash on delivery, warranty,
// premium quality), not per-product attributes. Every COD landing page
// should surface the same four reassurances.
const BENEFITS = [
  { icon: Truck, label: "Fast Delivery" },
  { icon: Wallet, label: "Cash On Delivery" },
  { icon: ShieldCheck, label: "30-Day Warranty" },
  { icon: Award, label: "Premium Quality" },
] as const;

export function BenefitsList() {
  return (
    <ul className="grid grid-cols-2 gap-2.5">
      {BENEFITS.map(({ icon: Icon, label }) => (
        <li
          key={label}
          className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium"
        >
          <Icon className="size-4 shrink-0 text-foreground" aria-hidden />
          <span className="truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}
