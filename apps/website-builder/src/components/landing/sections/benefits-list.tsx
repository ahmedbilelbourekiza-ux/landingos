import { Truck, Wallet, ShieldCheck, Award } from "lucide-react";

import type { LandingFeatureData } from "@/types/landing";
import { BENEFIT_ICONS, DEFAULT_BENEFIT_ICON } from "@/lib/landing/benefit-icons";

/* The trust strip under the price — LB.12.
 *
 * DATA-DRIVEN NOW: a merchant's own benefits (LandingFeature rows, authored
 * in the editor's Benefits section) render when any exist; the four standard
 * COD badges remain as the fallback so a page with none keeps the strip that
 * has been selling for it all along. An icon key that left the curated set
 * degrades to the default icon rather than a blank. */

const DEFAULT_BENEFITS = [
  { icon: Truck, label: "توصيل سريع" },
  { icon: Wallet, label: "الدفع عند الاستلام" },
  { icon: ShieldCheck, label: "ضمان 30 يوم" },
  { icon: Award, label: "جودة عالية" },
] as const;

const itemStyle = {
  borderColor: "var(--theme-border)",
  backgroundColor: "var(--theme-card)",
  borderWidth: "1px",
  borderStyle: "solid",
  borderRadius: "var(--theme-card-radius)",
  boxShadow: "var(--theme-card-shadow)",
} as const;

export function BenefitsList({ features = [] }: { features?: LandingFeatureData[] }) {
  if (features.length > 0) {
    return (
      <ul className="grid grid-cols-2 gap-2.5">
        {features.map((f) => {
          const Icon = BENEFIT_ICONS[f.icon] ?? BENEFIT_ICONS[DEFAULT_BENEFIT_ICON];
          return (
            <li
              key={f.id}
              className="flex items-center gap-2.5 px-3 py-3 text-sm font-medium transition-shadow hover:shadow-sm"
              style={itemStyle}
            >
              <Icon className="size-4 shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate">{f.title}</span>
                {f.description && (
                  <span className="block truncate text-xs font-normal opacity-70">
                    {f.description}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-2.5">
      {DEFAULT_BENEFITS.map(({ icon: Icon, label }) => (
        <li
          key={label}
          className="flex items-center gap-2.5 px-3 py-3 text-sm font-medium transition-shadow hover:shadow-sm"
          style={itemStyle}
        >
          <Icon className="size-4 shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden />
          <span className="truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}
