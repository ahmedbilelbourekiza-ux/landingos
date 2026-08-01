import { Truck } from "lucide-react";

// Arabic announcement bar — uses theme CSS variables.
export function AnnouncementBar() {
  return (
    <div className="text-white" style={{ backgroundColor: "var(--theme-primary)" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium tracking-wide sm:text-[13px]" dir="rtl">
        <Truck className="size-3.5 shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden />
        <span>توصيل مجاني · الدفع عند الاستلام</span>
      </div>
    </div>
  );
}
