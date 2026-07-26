import { Truck, Wallet, ShieldCheck, Award } from "lucide-react";

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
          className="flex items-center gap-2.5 px-3 py-3 text-sm font-medium transition-shadow hover:shadow-sm"
          style={{
            borderColor: "var(--theme-border)",
            backgroundColor: "var(--theme-card)",
            borderWidth: "1px",
            borderStyle: "solid",
            borderRadius: "var(--theme-card-radius)",
            boxShadow: "var(--theme-card-shadow)",
          }}
        >
          <Icon className="size-4 shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden />
          <span className="truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}
