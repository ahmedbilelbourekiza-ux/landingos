import { Truck } from "lucide-react";

// Arabic announcement bar — crimson background, gold truck icon accent.
export function AnnouncementBar() {
  return (
    <div style={{ backgroundColor: "var(--crimson)" }} className="text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium tracking-wide sm:text-[13px]" dir="rtl">
        <Truck className="size-3.5 shrink-0" style={{ color: "var(--gold)" }} aria-hidden />
        <span>توصيل مجاني · الدفع عند الاستلام</span>
      </div>
    </div>
  );
}
