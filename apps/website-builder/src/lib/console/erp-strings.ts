import type { CatalogStrings } from "@/components/console/erp/catalog-write";
import type { CarrierStrings } from "@/components/console/erp/carrier-write";
import type { FinanceStrings } from "@/components/console/erp/finance-write";
import type { AgentStrings } from "@/components/console/erp/agent-write";
import type { PagerStrings } from "@/components/console/pager";
import type { FilterStrings } from "@/components/console/filter-bar";
import type { OrderCreateStrings } from "@/components/console/erp/order-create";
import type { ExportStrings } from "@/components/console/erp/order-export";
import type {
  StructuredStrings,
  FixedCostRow,
} from "@/components/console/erp/settings-structured";
import type { CalculatorStrings } from "@/components/console/erp/profit-calculator";
import type { AiStrings } from "@/components/console/erp/ai-write";
import type { RowActionStrings } from "@/components/console/erp/order-row-actions";
import type { ClientEditStrings } from "@/components/console/erp/client-write";
import type { ClientExportStrings } from "@/components/console/erp/client-export";
import type { NotifyPrefStrings } from "@/components/console/notify-preferences";
import type { ChannelStrings } from "@/components/console/erp/channel-write";
import type { VariantEditorStrings } from "@/components/console/erp/variant-editor";
import type { ImportStrings } from "@/components/console/erp/csv-import";
import type {
  FollowupAssignStrings, CountdownStrings,
} from "@/components/console/erp/followup-assign";

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
    test: t("erp.carriers.test"),
    sync: t("erp.carriers.sync"),
    logs: t("erp.carriers.logs"),
    noLogs: t("erp.carriers.noLogs"),
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
    resetMissed: t("erp.agents.resetMissed"),
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

/** UI.12 — the sortable-header vocabulary, shared by every list that sorts. */
export function sortStrings(t: (key: string) => string) {
  return {
    sortBy: t("common.sortBy"),
    ascending: t("common.sortedAsc"),
    descending: t("common.sortedDesc"),
  };
}

/** UI.13 — the density control's labels. */
export function densityStrings(t: (key: string) => string) {
  return {
    density: t("common.density"),
    comfortable: t("common.densityComfortable"),
    compact: t("common.densityCompact"),
  };
}

/**
 * UI.12 — what a list says when it has nothing, told apart.
 *
 * "No orders yet" on `?status=cancelled` in a tenant with 4,000 orders is
 * simply false, and it sends the reader to the wrong next action: they go
 * looking for a create button when what they need is to clear a filter. Only
 * the caller knows which situation it is in, so the caller passes `filtered`.
 */
export function emptyCopy(
  t: (key: string) => string,
  filtered: boolean,
  nothingYet: string,
) {
  return filtered
    ? { title: t("common.noResults"), description: t("common.noResultsHint") }
    : { title: nothingYet };
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

/**
 * The export panel's labels.
 *
 * The FORMAT names are the carriers' own — "ZR Express", "Ecom Delivery",
 * "Ecotrac" — and are deliberately not translated: they are company names, and
 * a translated one is a file an operator cannot match to the portal they are
 * about to upload it to. Only the two report formats get a translated label,
 * because those describe what is inside rather than who it is for.
 */
export function orderExportStrings(t: (key: string) => string): ExportStrings {
  return {
    title: t("erp.export.title"),
    hint: t("erp.export.hint"),
    confirmed: t("erp.export.confirmedCount"),
    inView: t("erp.export.inViewCount"),
    formats: {
      zr: "ZR Express",
      ecom: "Ecom Delivery",
      ecotrac: "Ecotrac",
      orders: t("erp.export.reportOrders"),
      agents: t("erp.export.reportAgents"),
    },
  };
}

/* -----------------------------------------------------------------------------
 * The structured settings — LP.16b
 * -------------------------------------------------------------------------- */

export function structuredStrings(t: (key: string) => string): StructuredStrings {
  return {
    saving: t("common.saving"),
    save: t("common.save"),
    add: t("erp.write.add"),
    remove: t("common.delete"),
    fixedCosts: t("erp.settings.fixedCosts"),
    fixedCostsHint: t("erp.settings.fixedCostsHint"),
    label: t("erp.finance.charges"),
    monthlyAmount: t("erp.settings.monthlyAmount"),
    monthlyTotal: t("erp.settings.monthlyTotal"),
    noFixedCosts: t("erp.settings.noFixedCosts"),
    channelCarriers: t("erp.settings.defaultCarrierByChannel"),
    channelCarriersHint: t("erp.settings.channelCarrierHint"),
    noChannels: t("erp.settings.noChannels"),
    none: t("erp.write.unassigned"),
  };
}

/**
 * The stored `fixedCosts` value, as rows the editor can render.
 *
 * Tolerant on the way OUT and strict on the way IN, deliberately: rows written
 * through the API before this editor existed carry no `id`, and refusing to
 * display them would hide a cost the P&L is already charging. Anything that is
 * not an object at all is dropped rather than rendered as `[object Object]`.
 */
export function readFixedCostRows(value: unknown): FixedCostRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row, i) => {
    if (!row || typeof row !== "object") return [];
    const r = row as { id?: unknown; label?: unknown; amount?: unknown };
    return [{
      id: typeof r.id === "string" && r.id ? r.id : `fc_stored_${i}`,
      label: r.label === null || r.label === undefined ? "" : String(r.label),
      amount: r.amount === null || r.amount === undefined ? "" : String(r.amount),
    }];
  });
}

/** The stored `defaultCarrierByChannel` map, with only string values kept. */
export function readChannelCarriers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, code] of Object.entries(value as Record<string, unknown>)) {
    if (typeof code === "string" && code) out[key] = code;
  }
  return out;
}

/* -----------------------------------------------------------------------------
 * The profit/loss calculator — LP.16d
 * -------------------------------------------------------------------------- */

export function calculatorStrings(t: (key: string) => string): CalculatorStrings {
  return {
    saving: t("common.saving"),
    add: t("erp.write.add"),
    remove: t("common.delete"),
    product: t("erp.write.product"),
    addProduct: t("erp.calculator.addProduct"),
    sync: t("erp.calculator.sync"),
    syncHint: t("erp.calculator.syncHint"),
    noLink: t("erp.calculator.noLink"),
    sellPrice: t("erp.products.price"),
    buyPrice: t("erp.products.cost"),
    grossMargin: t("erp.calculator.grossMargin"),
    adsUsd: t("erp.calculator.adsUsd"),
    rate: t("erp.calculator.rate"),
    adsDa: t("erp.calculator.adsDa"),
    adsPerUnit: t("erp.calculator.adsPerUnit"),
    packaging: t("erp.write.packaging"),
    shipping: t("erp.write.shippingCosts"),
    totalUnitCost: t("erp.calculator.totalUnitCost"),
    unitsSold: t("erp.calculator.unitsSold"),
    caTheoretical: t("erp.calculator.caTheoretical"),
    profitPerUnit: t("erp.calculator.profitPerUnit"),
    returnCost: t("erp.calculator.returnCost"),
    returnCount: t("erp.calculator.returnCount"),
    exchanges: t("erp.calculator.exchanges"),
    addExchange: t("erp.calculator.addExchange"),
    lossCost: t("erp.calculator.lossCost"),
    lossCount: t("erp.calculator.lossCount"),
    incidents: t("erp.calculator.incidents"),
    realCa: t("erp.calculator.realCa"),
    caGap: t("erp.calculator.caGap"),
    allCosts: t("erp.calculator.allCosts"),
    profit: t("erp.calculator.profit"),
    roi: t("erp.calculator.roi"),
    breakEven: t("erp.calculator.breakEven"),
    breakEvenNever: t("erp.calculator.breakEvenNever"),
    returnRate: t("erp.calculator.returnRate"),
    netMargin: t("erp.calculator.netMargin"),
    units: t("erp.calculator.units"),
    grandTitle: t("erp.calculator.grandTitle"),
    sumProfit: t("erp.calculator.sumProfit"),
    otherCosts: t("erp.calculator.otherCosts"),
    fixedProrated: t("erp.calculator.fixedProrated"),
    unexpected: t("erp.write.unexpectedExpenses"),
    grandTotal: t("erp.calculator.grandTotal"),
    profitable: t("erp.calculator.profitable"),
    losing: t("erp.calculator.losing"),
    breakingEven: t("erp.calculator.breakingEven"),
    saveRecord: t("erp.write.saveRecord"),
    saveHint: t("erp.calculator.saveHint"),
    customWarning: t("erp.calculator.customWarning"),
    notes: t("erp.calculator.notes"),
    saved: t("erp.finance.saved"),
    aggregate: t("erp.calculator.aggregate"),
    aggregateHint: t("erp.calculator.aggregateHint"),
    aggregateOnly: t("erp.calculator.aggregateOnly"),
    aggregateMissing: t("erp.calculator.aggregateMissing"),
    aggregateFrom: t("erp.calculator.aggregateFrom"),
    saveAggregate: t("erp.calculator.saveAggregate"),
    incidentsInProductCosts: t("erp.calculator.incidentsInProductCosts"),
  };
}

/* -----------------------------------------------------------------------------
 * The AI screen — LP.17
 * -------------------------------------------------------------------------- */

export function aiStrings(t: (key: string) => string): AiStrings {
  return {
    saving: t("common.saving"),
    save: t("common.save"),
    cancel: t("erp.write.deactivate"),
    remove: t("common.delete"),
    addProvider: t("erp.ai.addProvider"),
    name: t("erp.ai.name"),
    type: t("erp.ai.type"),
    baseUrl: t("erp.ai.baseUrl"),
    apiKey: t("erp.write.apiKey"),
    defaultModel: t("erp.ai.defaultModel"),
    create: t("erp.write.create"),
    makeDefault: t("erp.write.makeDefault"),
    addAgent: t("erp.ai.addAgent"),
    description: t("erp.write.description"),
    systemPrompt: t("erp.ai.systemPrompt"),
    role: t("erp.ai.role"),
    provider: t("erp.ai.provider"),
    permissions: t("erp.ai.permissions"),
    permissionsHint: t("erp.ai.permissionsHint"),
    enabled: t("erp.write.activate"),
    none: t("erp.write.unassigned"),
    keyKept: t("erp.write.maskKeeps"),
    /* AUDIT.5. The same five strings the carrier and channel rows use, because
       they say the same thing about the same kind of integration. A fourth
       near-identical copy of "Hide log" is a translation somebody has to keep in
       step with two others for no gain. */
    test: t("erp.carriers.test"),
    testing: t("erp.channels.testing"),
    logs: t("erp.channels.logs"),
    hideLogs: t("erp.channels.hideLogs"),
    noLogs: t("erp.channels.noLogs"),
  };
}

/**
 * The inline row controls' labels — LP.8.
 *
 * Every one of them is an `aria-label` rather than a visible caption: four
 * selects on a table row with their captions beside them is the density
 * REGRESSION this slice exists to fix. The label still has to exist, because a
 * select whose only identification is its position in a row is unusable with a
 * screen reader.
 */
export function rowActionStrings(t: (key: string) => string): RowActionStrings {
  return {
    saving: t("erp.row.saving"),
    status: t("erp.orders.status"),
    agent: t("erp.orders.agent"),
    carrier: t("erp.row.carrier"),
    noAgent: t("erp.row.noAgent"),
    noCarrier: t("erp.row.noCarrier"),
    express: t("erp.row.expressShort"),
    quickActions: t("erp.row.quickActions"),
  };
}

/**
 * The customer-record correction form's labels — LP.10.
 *
 * `editHint` is not decoration. The counters sit directly above this form and
 * look editable; saying they are not, on the page, is cheaper than letting an
 * operator discover it as a 422 (and the route does refuse them by name).
 */
export function clientEditStrings(t: (key: string) => string): ClientEditStrings {
  return {
    saving: t("common.saving"),
    panel: t("erp.clients.editPanel"),
    name: t("erp.clients.name"),
    wilaya: t("erp.orders.wilaya"),
    commune: t("erp.orders.commune"),
    address: t("erp.clients.address"),
    save: t("common.save"),
    hint: t("erp.clients.editHint"),
  };
}

/** The registry export link's labels — LP.10. */
export function clientExportStrings(t: (key: string) => string): ClientExportStrings {
  return {
    title: t("erp.clients.exportTitle"),
    hint: t("erp.clients.exportHint"),
    download: t("erp.clients.exportDownload"),
    inView: t("erp.export.inViewCount"),
  };
}


/**
 * The alert-preferences panel's labels — LP.11.
 *
 * A PLATFORM bundle living in this file, which is otherwise the ERP's. It is
 * here rather than in a second module because the file is already the console's
 * one place for "translate on the server, hand the client strings", and a
 * platform-strings module holding one function would be a directory to explain.
 * The keys themselves are under `notifications.*`, which is where they belong.
 */
export function notifyPrefStrings(t: (key: string) => string): NotifyPrefStrings {
  return {
    saving: t("common.saving"),
    panel: t("notifications.prefsPanel"),
    hint: t("notifications.prefsHint"),
    sound: t("notifications.sound"),
    volume: t("notifications.volume"),
    desktop: t("notifications.desktop"),
    desktopBlocked: t("notifications.desktopBlocked"),
    desktopAsk: t("notifications.desktopAsk"),
    test: t("notifications.test"),
    save: t("common.save"),
    saved: t("notifications.saved"),
    families: {
      new_order: t("notifications.familyNewOrder"),
      abandoned: t("notifications.familyAbandoned"),
      assignment: t("notifications.familyAssignment"),
      manipulation: t("notifications.familyManipulation"),
      delivery: t("notifications.familyDelivery"),
      followup: t("notifications.familyFollowup"),
    },
  };
}


/** The sales-channel screen's labels — LP.15. */
export function channelStrings(t: (key: string) => string): ChannelStrings {
  return {
    saving: t("common.saving"),
    newChannel: t("erp.channels.newChannel"),
    name: t("erp.channels.title"),
    platform: t("erp.orders.source"),
    brand: t("erp.orders.brand"),
    apiUrl: t("erp.write.apiUrl"),
    apiKey: t("erp.write.apiKey"),
    apiSecret: t("erp.write.secretKey"),
    webhookSecret: t("erp.write.webhookSecret"),
    webhookUrl: t("erp.channels.webhookUrl"),
    webhookHint: t("erp.channels.webhookHint"),
    create: t("erp.write.create"),
    save: t("common.save"),
    cancel: t("common.cancel"),
    test: t("erp.carriers.test"),
    testing: t("erp.channels.testing"),
    logs: t("erp.channels.logs"),
    hideLogs: t("erp.channels.hideLogs"),
    noLogs: t("erp.channels.noLogs"),
    deactivate: t("erp.write.deactivate"),
    activate: t("erp.write.activate"),
    maskKeeps: t("erp.write.maskKeeps"),
    noAdapter: t("erp.channels.noAdapter"),
    structural: t("erp.channels.structural"),
  };
}


/** The variant editor's labels — LP.18. */
export function variantEditorStrings(t: (key: string) => string): VariantEditorStrings {
  return {
    saving: t("common.saving"),
    panel: t("erp.variants.panel"),
    hint: t("erp.variants.hint"),
    product: t("erp.write.product"),
    optionName: t("erp.variants.optionName"),
    optionValues: t("erp.variants.optionValues"),
    addOption: t("erp.variants.addOption"),
    generate: t("erp.variants.generate"),
    generateHint: t("erp.variants.generateHint"),
    variant: t("erp.inventory.variant"),
    sku: t("erp.products.sku"),
    stock: t("erp.products.stock"),
    threshold: t("erp.inventory.threshold"),
    addVariant: t("erp.variants.addVariant"),
    remove: t("erp.variants.remove"),
    reason: t("erp.inventory.reason"),
    save: t("common.save"),
    noVariants: t("erp.variants.noVariants"),
  };
}


/**
 * The CSV import panel's labels — LP.19.
 *
 * `kind` picks the hint, and the hint is the only difference: a customer import
 * merges and an order import dedups, and saying which BEFORE somebody presses
 * the button is what stops "why did it say merged" arriving afterwards.
 */
export function importStrings(t: (key: string) => string, kind: "clients" | "orders"): ImportStrings {
  return {
    saving: t("common.saving"),
    panel: t("erp.import.panel"),
    hint: kind === "clients" ? t("erp.import.clientsHint") : t("erp.import.ordersHint"),
    file: t("erp.import.file"),
    source: t("erp.import.source"),
    preview: t("erp.import.preview"),
    commit: t("erp.import.commit"),
    created: t("erp.import.created"),
    merged: t("erp.import.merged"),
    duplicates: t("erp.import.duplicates"),
    skipped: t("erp.import.skipped"),
    rows: t("erp.import.rows"),
    previewFirst: t("erp.import.previewFirst"),
    done: t("erp.import.done"),
  };
}


/** The follow-up assignment control's labels — LP.21. */
export function followupAssignStrings(t: (key: string) => string): FollowupAssignStrings {
  return {
    saving: t("common.saving"),
    assignTo: t("erp.followUp.assignTo"),
    assign: t("erp.followUp.assign"),
    auto: t("erp.followUp.auto"),
    unassigned: t("erp.followUp.unassigned"),
  };
}

/** The live countdown's labels — LP.21, N14. */
export function countdownStrings(t: (key: string) => string): CountdownStrings {
  return {
    inMinutes: t("erp.followUp.inMinutes"),
    inHours: t("erp.followUp.inHours"),
    overdueBy: t("erp.followUp.overdueBy"),
    dueNow: t("erp.followUp.dueNow"),
  };
}
