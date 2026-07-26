"use client";

import { motion } from "framer-motion";

import { PriceBlock } from "./price-block";
import { BenefitsList } from "./benefits-list";
import { VariantSelectors } from "./variant-selectors";
import { OrderSummary } from "./order-summary";
import { PurchaseForm } from "./purchase-form";
import type { LandingPageData } from "@/types/landing";
import type { LandingOrderStore } from "@/lib/landing/store";

export function ProductInfo({
  page,
  store,
}: {
  page: LandingPageData;
  store: LandingOrderStore;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.08 }}
      className="flex flex-col gap-6"
      dir="rtl"
    >
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

      <div className="py-1">
        <PriceBlock price={page.price} oldPrice={page.oldPrice} currency={page.currency} />
      </div>

      <BenefitsList />

      <VariantSelectors store={store} currency={page.currency} />

      <OrderSummary store={store} currency={page.currency} />

      <div className="border-t pt-6" style={{ borderColor: "var(--theme-border)" }}>
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
