import { Truck } from "lucide-react";

// Thin top strip carrying a single conversion message. Kept to one line so
// it never wraps awkwardly on narrow screens; the message is intentionally
// short — it's a glance, not a paragraph.
export function AnnouncementBar() {
  return (
    <div className="bg-foreground text-background">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium tracking-wide sm:text-[13px]">
        <Truck className="size-3.5 shrink-0" aria-hidden />
        <span>Free delivery nationwide · Cash on Delivery available</span>
      </div>
    </div>
  );
}
