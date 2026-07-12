"use client";

import { motion } from "framer-motion";

import { PriceBlock } from "./price-block";
import { BenefitsList } from "./benefits-list";
import { VariantSelectors } from "./variant-selectors";
import { OrderSummary } from "./order-summary";
import { PurchaseForm } from "./purchase-form";
import type { LandingPageData } from "@/types/landing";
import type { LandingOrderStore } from "@/lib/landing/store";

// The right-hand column of the product hero: identity, price, trust badges,
// variant selection, live order summary, and the purchase form.
export function ProductInfo({
  page,
  store,
}: {
  page: LandingPageData;
  store: LandingOrderStore;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
      className="flex flex-col gap-6"
      dir="rtl"
    >
      {/* Title — larger, bolder for stronger hierarchy */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {page.title}
        </h1>
        {page.description && (
          <p className="text-base leading-relaxed text-muted-foreground">
            {page.description}
          </p>
        )}
      </div>

      {/* Price — visually stronger with more vertical presence */}
      <div className="py-1">
        <PriceBlock
          price={page.price}
          oldPrice={page.oldPrice}
          currency={page.currency}
        />
      </div>

      <BenefitsList />

      <VariantSelectors store={store} currency={page.currency} />

      <OrderSummary store={store} currency={page.currency} />

      <div className="border-t pt-6">
        <PurchaseForm
          store={store}
          landingId={page.id}
          buttonText={page.buttonText}
          currency={page.currency}
        />
      </div>
    </motion.div>
  );
}
