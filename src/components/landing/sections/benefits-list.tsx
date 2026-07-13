import { Truck, Wallet, ShieldCheck, Award } from "lucide-react";

// Trust badges with accent-colored icons.
const BENEFITS = [
  { icon: Truck, label: "توصيل سريع" },
  { icon: Wallet, label: "الدفع عند الاستلام" },
  { icon: ShieldCheck, label: "ضمان 30 يوم" },
  { icon: Award, label: "جودة عالية" },
] as const;

export function BenefitsList() {
  return (
    <ul className="grid grid-cols-2 gap-2.5">
      {BENEFITS.map(({ icon: Icon, label }) => (
        <li
          key={label}
          className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-3 text-sm font-medium shadow-sm"
          style={{ borderColor: "var(--theme-border)", backgroundColor: "var(--theme-card)" }}
        >
          <Icon className="size-4 shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden />
          <span className="truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}
