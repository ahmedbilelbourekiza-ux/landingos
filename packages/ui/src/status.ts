/* =============================================================================
 * The status vocabulary, shared by every product.
 *
 * Both products describe records that move through a lifecycle, and both were
 * inventing their own colours for it. This maps every status EITHER product
 * uses onto the six semantic tones in tokens.css, so a "cancelled" order looks
 * the same whichever screen it appears on — which is most of what makes two
 * applications feel like one.
 *
 * Adding a product means adding entries here, not adding colours.
 *
 * Labels are i18n KEYS, never literals. The platform ships in Arabic, French
 * and English (D4), and a hardcoded English label is one that has to be found
 * and removed later — the ~2,300 already waiting in the ERP are the reason
 * this rule exists (R-13).
 * ========================================================================== */

/** The six tones. Every status resolves to exactly one. */
export type StatusTone =
  | 'success'   // reached a good terminal state
  | 'warning'   // needs a person to do something
  | 'danger'    // failed, refused, or was cancelled
  | 'info'      // acknowledged, waiting on someone else
  | 'progress'  // moving through a pipeline
  | 'neutral';  // inactive, unknown, not yet actioned

export interface StatusDescriptor {
  readonly tone: StatusTone;
  readonly labelKey: string;
}

/**
 * ERP confirmation statuses — the call-centre workflow.
 *
 * `pending` was gold in the ERP. Gold is the storefront's accent under D3, so
 * carrying it into the console would mean one colour meaning "brand" in one
 * place and "waiting" in another. It is amber here, which is what the tone
 * meant all along.
 */
export const CONFIRMATION_STATUS: Record<string, StatusDescriptor> = {
  pending:     { tone: 'warning', labelKey: 'status.confirmation.pending' },
  confirmed:   { tone: 'success', labelKey: 'status.confirmation.confirmed' },
  cancelled:   { tone: 'danger',  labelKey: 'status.confirmation.cancelled' },
  callback:    { tone: 'info',    labelKey: 'status.confirmation.callback' },
  no_answer:   { tone: 'neutral', labelKey: 'status.confirmation.noAnswer' },
  unreachable: { tone: 'neutral', labelKey: 'status.confirmation.unreachable' },
  abandoned:   { tone: 'warning', labelKey: 'status.confirmation.abandoned' },
  // The three escalating attempts. First-class ERP statuses — they appear in
  // ORDER_STATUSES, in CALL_RESULTS and in the attempts matrix — and they were
  // missing here until Phase 6.3 offered a result picker and three of its eight
  // buttons came back labelled "Unknown". The read screens never showed it
  // because nothing had reached a tentative state.
  //
  // One tone for all three, not the ERP's escalating yellow → orange → rust.
  // Each one means the same thing to whoever is looking at the queue — call
  // this person back — and the attempt NUMBER is already in the label. Three
  // shades of "call back" would be three things to learn where one is a glance,
  // which is the reasoning DELIVERY_STATUS already follows below.
  tentative1:  { tone: 'warning', labelKey: 'status.confirmation.tentative1' },
  tentative2:  { tone: 'warning', labelKey: 'status.confirmation.tentative2' },
  tentative3:  { tone: 'warning', labelKey: 'status.confirmation.tentative3' },
};

/**
 * ERP delivery statuses — the carrier lifecycle.
 *
 * Everything genuinely in motion shares one tone rather than getting a colour
 * each. Four shades of "on its way" is four things to learn; one is a glance.
 */
export const DELIVERY_STATUS: Record<string, StatusDescriptor> = {
  created:          { tone: 'neutral',  labelKey: 'status.delivery.created' },
  pending:          { tone: 'warning',  labelKey: 'status.delivery.pending' },
  dispatched:       { tone: 'progress', labelKey: 'status.delivery.dispatched' },
  in_transit:       { tone: 'progress', labelKey: 'status.delivery.inTransit' },
  out_for_delivery: { tone: 'progress', labelKey: 'status.delivery.outForDelivery' },
  at_office:        { tone: 'info',     labelKey: 'status.delivery.atOffice' },
  delivered:        { tone: 'success',  labelKey: 'status.delivery.delivered' },
  refused:          { tone: 'danger',   labelKey: 'status.delivery.refused' },
  returned:         { tone: 'danger',   labelKey: 'status.delivery.returned' },
  cancelled:        { tone: 'danger',   labelKey: 'status.delivery.cancelled' },
};

/**
 * Website-builder order statuses (the SalesOrderStatus enum).
 *
 * Deliberately mapped to the same tones as the ERP's equivalents: an order the
 * customer sees as CONFIRMED and the same order in the ERP must not be
 * different colours in two tabs of one product.
 */
export const SALES_ORDER_STATUS: Record<string, StatusDescriptor> = {
  NEW:       { tone: 'info',     labelKey: 'status.salesOrder.new' },
  CONFIRMED: { tone: 'success',  labelKey: 'status.salesOrder.confirmed' },
  PREPARING: { tone: 'progress', labelKey: 'status.salesOrder.preparing' },
  SHIPPED:   { tone: 'progress', labelKey: 'status.salesOrder.shipped' },
  DELIVERED: { tone: 'success',  labelKey: 'status.salesOrder.delivered' },
  CANCELLED: { tone: 'danger',   labelKey: 'status.salesOrder.cancelled' },
};

/** Landing-page editorial lifecycle. */
export const LANDING_PAGE_STATUS: Record<string, StatusDescriptor> = {
  DRAFT:     { tone: 'neutral',  labelKey: 'status.landingPage.draft' },
  PUBLISHED: { tone: 'success',  labelKey: 'status.landingPage.published' },
  ARCHIVED:  { tone: 'neutral',  labelKey: 'status.landingPage.archived' },
};

/** Every registry, for lookup and for the tests that keep them honest. */
export const STATUS_REGISTRIES = {
  confirmation: CONFIRMATION_STATUS,
  delivery: DELIVERY_STATUS,
  salesOrder: SALES_ORDER_STATUS,
  landingPage: LANDING_PAGE_STATUS,
} as const;

export type StatusRegistryName = keyof typeof STATUS_REGISTRIES;

/**
 * Resolve a status to its descriptor.
 *
 * Falls back to `neutral` rather than throwing. An unknown status is a data
 * problem, and a grey chip showing the raw value is far more useful to whoever
 * has to diagnose it than a crashed table — but it is never coloured, because
 * guessing a tone would be worse than admitting we do not know one.
 */
export function resolveStatus(
  registry: StatusRegistryName,
  status: string | null | undefined,
): StatusDescriptor & { known: boolean } {
  const found = status ? STATUS_REGISTRIES[registry][status] : undefined;
  if (found) return { ...found, known: true };
  return { tone: 'neutral', labelKey: 'status.unknown', known: false };
}

/** The CSS custom properties backing a tone. */
export function toneVars(tone: StatusTone) {
  return {
    color: `var(--${tone}-fg)`,
    backgroundColor: `var(--${tone}-bg)`,
    borderColor: `var(--${tone}-border)`,
  };
}
