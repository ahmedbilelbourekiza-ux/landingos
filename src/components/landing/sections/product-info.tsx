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
// variant selection, live order summary, and the purchase form. Ordered for
// conversion — price and reassurance first, then configuration, then the
// action. Every sub-component reads from the shared order store so quantity
// and variant changes propagate to the summary and button label instantly.
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
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {page.title}
        </h1>
        {page.description && (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {page.description}
          </p>
        )}
      </div>

      <PriceBlock
        price={page.price}
        oldPrice={page.oldPrice}
        currency={page.currency}
      />

      <BenefitsList />

      <VariantSelectors store={store} currency={page.currency} />

      <OrderSummary store={store} currency={page.currency} />

      <div className="border-t pt-6">
        <PurchaseForm
          store={store}
          buttonText={page.buttonText}
          currency={page.currency}
        />
      </div>
    </motion.div>
  );
}
