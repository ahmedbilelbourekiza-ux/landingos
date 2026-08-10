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

      {/* LB.12 — the merchant's own benefits when any exist, the standard COD
          badges otherwise; `showFeatures` (default true) can hide the strip. */}
      {(page.setting?.showFeatures ?? true) && <BenefitsList features={page.features} />}

      <VariantSelectors store={store} currency={page.currency} />

      <OrderSummary store={store} currency={page.currency} />

      <div className="border-t pt-6" style={{ borderColor: "var(--theme-border)" }}>
        <PurchaseForm
          store={store}
          landingId={page.id}
          productTitle={page.title}
          buttonText={page.buttonText}
          currency={page.currency}
          config={page.orderForm}
          // Defaults match the schema's: a product with no settings row has
          // always been home-delivery-only.
          homeDeliveryEnabled={page.setting?.homeDeliveryEnabled ?? true}
          stopDeskEnabled={page.setting?.stopDeskEnabled ?? false}
        />
      </div>
    </motion.div>
  );
}
