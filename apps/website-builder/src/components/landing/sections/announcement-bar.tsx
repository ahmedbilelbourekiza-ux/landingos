import { Truck } from "lucide-react";

// Arabic announcement bar — uses theme CSS variables.
export function AnnouncementBar() {
  return (
    /* --theme-primary-foreground, not text-white — the pair the theme
       contract guarantees. Hardcoded white passes every CURRENT preset (all
       ship dark primaries) but is the LB.51 badge defect one component over:
       an extracted theme with a light primary gets a near-black foreground
       chosen for it, and this bar would have stayed white on light
       (19 Aug sweep). */
    <div style={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-primary-foreground)" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium tracking-wide sm:text-[13px]" dir="rtl">
        <Truck className="size-3.5 shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden />
        <span>توصيل مجاني · الدفع عند الاستلام</span>
      </div>
    </div>
  );
}
