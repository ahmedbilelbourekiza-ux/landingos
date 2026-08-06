import type { CatalogStrings } from "@/components/console/erp/catalog-write";
import type { CarrierStrings } from "@/components/console/erp/carrier-write";
import type { FinanceStrings } from "@/components/console/erp/finance-write";
import type { AgentStrings } from "@/components/console/erp/agent-write";
import type { PagerStrings } from "@/components/console/pager";
import type { FilterStrings } from "@/components/console/filter-bar";
import type { OrderCreateStrings } from "@/components/console/erp/order-create";

/* =============================================================================
 * The ERP's write-control labels, resolved once per screen.
 *
 * Some bundles are needed by two screens — the catalogue one by products AND
 * inventory — and building it twice is how one of them ends up a key behind the
 * other. No directive: the server calls these, the client only receives the
 * result, which is the shape every client component in this console has.
 * ========================================================================== */

export function catalogStrings(t: (key: string) => string): CatalogStrings {
  return {
    saving: t("common.saving"),
    save: t("common.cancel"),
    newProduct: t("erp.write.newProduct"),
    name: t("erp.products.title"),
    sku: t("erp.products.sku"),
    brand: t("erp.orders.brand"),
    price: t("erp.products.price"),
    cost: t("erp.products.cost"),
    packaging: t("erp.write.packaging"),
    threshold: t("erp.inventory.threshold"),
    stock: t("erp.products.stock"),
    create: t("erp.write.create"),
    editProduct: t("erp.write.editProduct"),
    apply: t("erp.write.apply"),
    cancel: t("common.cancel"),
    description: t("erp.write.description"),
    archive: t("erp.write.archive"),
    restore: t("erp.write.restore"),
    adjustPanel: t("erp.write.adjustPanel"),
    adjustHint: t("erp.write.adjustHint"),
    product: t("erp.write.product"),
    variant: t("erp.inventory.variant"),
    allVariants: t("erp.write.allVariants"),
    // The movement ledger already labels these columns; one word, one key.
    change: t("erp.inventory.change"),
    reason: t("erp.inventory.reason"),
    adjust: t("erp.write.adjust"),
    lotPanel: t("erp.write.lotPanel"),
    lotHint: t("erp.write.lotHint"),
    mode: t("erp.write.mode"),
    purchase: t("erp.write.purchase"),
    restock: t("erp.write.restock"),
    quantity: t("erp.orders.quantity"),
    unitCost: t("erp.write.unitCost"),
    addLot: t("erp.write.addLot"),
  };
}

export function carrierStrings(t: (key: string) => string): CarrierStrings {
  return {
    saving: t("common.saving"),
    cancel: t("common.cancel"),
    save: t("common.save"),
    newCarrier: t("erp.write.newCarrier"),
    name: t("erp.carriers.title"),
    code: t("erp.carriers.code"),
    adapter: t("erp.carriers.adapter"),
    apiUrl: t("erp.write.apiUrl"),
    apiKey: t("erp.write.apiKey"),
    secretKey: t("erp.write.secretKey"),
    webhookSecret: t("erp.write.webhookSecret"),
    webhookUrl: t("erp.carriers.webhookUrl"),
    webhookHint: t("erp.carriers.webhookHint"),
    create: t("erp.write.create"),
    makeDefault: t("erp.write.makeDefault"),
    deactivate: t("erp.write.deactivate"),
    activate: t("erp.write.activate"),
    credentials: t("erp.carriers.credentials"),
    maskKeeps: t("erp.write.maskKeeps"),
    mappings: t("erp.write.mappings"),
    carrierSays: t("erp.write.carrierSays"),
    meansStatus: t("erp.write.meansStatus"),
    addMapping: t("erp.write.addMapping"),
    noMappings: t("erp.write.noMappings"),
  };
}

export function financeStrings(t: (key: string) => string): FinanceStrings {
  return {
    saving: t("common.saving"),
    addCharge: t("erp.write.addCharge"),
    label: t("erp.finance.charges"),
    amount: t("erp.write.amount"),
    date: t("erp.orders.placed"),
    add: t("erp.write.add"),
    remove: t("common.delete"),
    savePanel: t("erp.write.savePanel"),
    periodType: t("erp.finance.period"),
    from: t("erp.write.from"),
    to: t("erp.write.to"),
    revenue: t("erp.finance.revenue"),
    productCosts: t("erp.write.productCosts"),
    shippingCosts: t("erp.write.shippingCosts"),
    advertisingCosts: t("erp.write.advertisingCosts"),
    fixedExpenses: t("erp.write.fixedExpenses"),
    unexpectedExpenses: t("erp.write.unexpectedExpenses"),
    derivedHint: t("erp.write.derivedHint"),
    saveRecord: t("erp.write.saveRecord"),
  };
}

export function agentStrings(t: (key: string) => string): AgentStrings {
  return {
    saving: t("common.saving"),
    save: t("common.save"),
    edit: t("common.edit"),
    cancel: t("common.cancel"),
    jobRole: t("erp.agents.jobRole"),
    salary: t("erp.agents.salary"),
    perConfirmed: t("erp.agents.perConfirmed"),
    perDelivered: t("erp.agents.perDelivered"),
    daysOff: t("erp.agents.daysOff"),
    suspend: t("erp.write.suspend"),
    reactivate: t("erp.write.reactivate"),
    // Sunday first, because that is what getDay() returns and what the config
    // stores — the labels follow the data, not the local week convention.
    days: [
      t("erp.write.day0"), t("erp.write.day1"), t("erp.write.day2"), t("erp.write.day3"),
      t("erp.write.day4"), t("erp.write.day5"), t("erp.write.day6"),
    ],
  };
}

/* -----------------------------------------------------------------------------
 * Shared list chrome — LP.3
 *
 * Not ERP-specific despite the file: a pager and a filter bar are console
 * furniture, and the builder's lists want the same two bundles. They live here
 * because this is where the console's string bundles already are, and moving
 * the file is a rename nobody needs today.
 * -------------------------------------------------------------------------- */

export function pagerStrings(t: (key: string) => string): PagerStrings {
  return {
    previous: t("common.previous"),
    next: t("common.next"),
    position: t("common.pagePosition"),
    total: t("common.resultCount"),
  };
}

export function filterStrings(t: (key: string) => string): FilterStrings {
  return {
    apply: t("erp.filters.apply"),
    clear: t("erp.filters.clear"),
    any: t("erp.filters.any"),
  };
}

/**
 * The new-order panel's labels — LP.4.
 *
 * Every one of these already existed: an order's fields are named on the list
 * and on the detail screen, and naming them a third time is how two spellings
 * of "Commune" end up in the same product.
 */
export function orderCreateStrings(t: (key: string) => string): OrderCreateStrings {
  return {
    saving: t("common.saving"),
    cancel: t("common.cancel"),
    newOrder: t("erp.write.newOrder"),
    createOrder: t("erp.write.createOrder"),
    hint: t("erp.write.orderHint"),
    customer: t("erp.orders.customer"),
    phone: t("erp.clients.phone"),
    wilaya: t("erp.orders.wilaya"),
    commune: t("erp.orders.commune"),
    city: t("erp.orders.city"),
    product: t("erp.orders.product"),
    variant: t("erp.orders.variant"),
    quantity: t("erp.orders.quantity"),
    price: t("erp.orders.total"),
    status: t("erp.orders.status"),
    agent: t("erp.orders.agent"),
    unassigned: t("erp.orders.unassigned"),
    carrier: t("erp.carriers.title"),
    defaultCarrier: t("erp.write.defaultCarrier"),
    note: t("erp.order.note"),
  };
}
