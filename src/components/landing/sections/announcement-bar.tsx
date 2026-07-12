import { Truck } from "lucide-react";

// Thin top strip carrying a single Arabic conversion message.
export function AnnouncementBar() {
  return (
    <div className="bg-foreground text-background">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium tracking-wide sm:text-[13px]" dir="rtl">
        <Truck className="size-3.5 shrink-0" aria-hidden />
        <span>توصيل مجاني · الدفع عند الاستلام</span>
      </div>
    </div>
  );
}
