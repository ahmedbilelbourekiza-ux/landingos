"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/landing/format";
import type { LandingOrderStore } from "@/lib/landing/store";
import { useOrderTotals } from "@/lib/landing/store";

// Mobile-only sticky CTA. Hidden on desktop where the form is always visible
// in the right column. Appears once the purchase form scrolls out of view
// (tracked via IntersectionObserver on the form element) and re-hides when
// the form comes back — so it never duplicates the in-page button. Tapping
// it smooth-scrolls back to the form.
export function StickyBuyButton({
  store,
  buttonText,
  currency,
}: {
  store: LandingOrderStore;
  buttonText: string;
  currency: string;
}) {
  const { subtotal } = useOrderTotals(store);
  const [visible, setVisible] = React.useState(false);
  const targetRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    // The purchase form is wrapped in a section with id="product". Observing
    // it means the sticky button hides whenever the form is on-screen.
    const el = document.getElementById("product");
    targetRef.current = el;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      // Trigger when the form has fully left the viewport bottom.
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollToForm = () => {
    targetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur-md lg:hidden"
          // Respect the iOS safe area so the button never sits under the
          // home indicator on notched devices.
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <Button
            type="button"
            size="lg"
            onClick={scrollToForm}
            className="h-14 w-full rounded-xl text-base font-bold shadow-lg"
          >
            <ShoppingBag className="size-4" />
            {buttonText} · {formatPrice(subtotal, currency)}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
