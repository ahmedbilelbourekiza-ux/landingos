/* =============================================================================
 * lib/statusMap.js — Universal delivery status system.
 *
 * Every carrier reports its own status strings. We normalize them into a fixed
 * set of CRM statuses so the UI, notifications, and filters are consistent no
 * matter which provider handled the parcel. The ORIGINAL provider status is
 * always preserved alongside (stored on each shipment_event), so nothing is
 * lost in translation.
 * ========================================================================== */

// Canonical CRM statuses, ordered along the shipment lifecycle.
const CRM_STATUSES = [
  'pending',          // shipment created but no movement yet
  'created',          // picked up / registered at provider
  'dispatched',       // dispatched to regional hub
  'in_transit',       // in route / between hubs
  'at_office',        // arrived at destination office (Au bureau)
  'out_for_delivery', // out with courier (Sorti en livraison)
  'delivered',        // delivered to customer
  'refused',          // customer refused
  'returned',         // returned to sender
  'cancelled',        // shipment cancelled
];

// Human labels (FR primary — matches the example timeline in the spec).
const CRM_STATUS_LABEL = {
  pending:          'En attente',
  created:          'Création',
  dispatched:       'Dispatché',
  in_transit:       'En route',
  at_office:        'Au bureau',
  out_for_delivery: 'Sorti en livraison',
  delivered:        'Livré',
  refused:          'Refusé',
  returned:         'Retourné',
  cancelled:        'Annulé',
};

// Statuses that mark the end of a shipment's active life. The polling job
// stops refreshing these.
const TERMINAL_STATUSES = ['delivered', 'refused', 'returned', 'cancelled'];

// Which CRM statuses should fire a notification (see notifications.js).
const NOTIFY_STATUSES = [
  'created', 'dispatched', 'out_for_delivery',
  'delivered', 'refused', 'returned', 'cancelled',
];

function isTerminal(status) { return TERMINAL_STATUSES.includes(status); }
function shouldNotify(status) { return NOTIFY_STATUSES.includes(status); }

/**
 * Map a provider's raw status string to a CRM status.
 * Each adapter ships its own map; this is the shared fuzzy fallback used by the
 * generic/mock adapters and by webhook payloads we don't have a precise map for.
 * Returns 'pending' if nothing matches.
 */
const FALLBACK_KEYWORDS = [
  [/\b(creat|nouvell|pick|enregist|registr)/i,    'created'],
  [/\b(dispatch|sortie hub|transmis)/i,           'dispatched'],
  [/\b(transit|en route|route|movement|on the way)/i, 'in_transit'],
  [/\b(office|bureau|agence|arrived|stock)/i,     'at_office'],
  [/\b(out for delivery|livraison|coursier|tournée)/i, 'out_for_delivery'],
  [/\b(deliver|livré|received by|remis)/i,        'delivered'],
  [/\b(refus|rejected)/i,                         'refused'],
  [/\b(return|retour|RT|back to sender)/i,        'returned'],
  [/\b(cancel|annul)/i,                           'cancelled'],
];

function mapStatus(rawStatus, adapterMap = {}) {
  if (!rawStatus) return 'pending';
  const s = String(rawStatus).trim();

  // 1. exact key match in the adapter's own map (case-insensitive)
  const lk = s.toLowerCase();
  for (const [k, v] of Object.entries(adapterMap)) {
    if (k.toLowerCase() === lk) return v;
  }
  // 2. adapter map as substring
  for (const [k, v] of Object.entries(adapterMap)) {
    if (s.toLowerCase().includes(k.toLowerCase())) return v;
  }
  // 3. shared keyword fallback
  for (const [re, crm] of FALLBACK_KEYWORDS) {
    if (re.test(s)) return crm;
  }
  return 'pending';
}

module.exports = {
  CRM_STATUSES,
  CRM_STATUS_LABEL,
  TERMINAL_STATUSES,
  NOTIFY_STATUSES,
  isTerminal,
  shouldNotify,
  mapStatus,
};
