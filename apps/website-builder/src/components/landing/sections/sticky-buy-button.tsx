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
    // Use scroll listener instead of IntersectionObserver because the form
    // can be taller than the viewport, making IntersectionObserver unreliable.
    // Show sticky when the CTA button's top scrolls above 60% of the viewport
    // height (i.e., the user has scrolled past most of the form).
    const cta = document.querySelector('button[type="submit"]');
    const el = cta || document.getElementById("product");
    targetRef.current = el;
    if (!el) return;

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      // Show sticky when the CTA button is in the upper 20% of the viewport
      // or has scrolled completely above it. At this point the user has
      // scrolled past the CTA and needs the sticky button to take action.
      setVisible(rect.bottom < window.innerHeight * 0.8);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
            className="h-14 w-full text-base font-bold shadow-lg"
            style={{
              backgroundColor: "var(--theme-primary)",
              color: "var(--theme-primary-foreground)",
              borderRadius: "var(--theme-button-radius)",
            }}
          >
            <ShoppingBag className="size-4" />
            {buttonText} · {formatPrice(subtotal, currency)}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
