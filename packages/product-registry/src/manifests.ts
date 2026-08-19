import type { ProductManifest } from './types.ts';

/* =============================================================================
 * The products LandingOS ships today.
 *
 * These describe each product's own console. Platform surfaces — company,
 * team, billing, notifications, integrations, security, profile — are
 * deliberately absent: the shell owns those and shows them once, not once per
 * product. That separation is the reason a tenant with three products does
 * not get three Settings screens.
 *
 * Navigation here reflects what each product has NOW. Phase 4 mounts these in
 * the shared shell and Phase 6 rebuilds the ERP's screens; when nav changes,
 * this file is the one place it changes.
 * ========================================================================== */

export const websiteBuilder: ProductManifest = {
  id: 'website-builder',
  nameKey: 'product.websiteBuilder.name',
  descriptionKey: 'product.websiteBuilder.description',
  icon: 'layout-template',
  basePath: '/builder',
  entitlement: 'product.website-builder',
  permissions: [
    'website-builder:read',
    'website-builder:pages:write',
    'website-builder:pages:publish',
    'website-builder:orders:read',
    // LB.10 (audit B-08). Moving an order through its lifecycle is a WRITE,
    // and it was gated on orders:read — a VIEWER could confirm an order.
    // MANAGER's `*:*:write` glob grants this; MEMBER/VIEWER need it by name.
    'website-builder:orders:write',
    'website-builder:settings:write',
  ],
  /* `group` is UI.8. A flat list of seven is readable; a flat list of fifteen
     (see the ERP below) is not, and the grouping has to be declared HERE
     because the shell must never learn what a product contains. Order within a
     group is declaration order, and the ungrouped items lead. */
  nav: [
    { id: 'overview', titleKey: 'builder.nav.overview', path: '', icon: 'layout-dashboard' },
    { id: 'pages', titleKey: 'builder.nav.pages', path: 'pages', icon: 'file-text', group: 'builder.navGroup.content' },
    { id: 'categories', titleKey: 'builder.nav.categories', path: 'categories', icon: 'folder-open', group: 'builder.navGroup.content' },
    // LB.36 — brands: the public identities pages sell under.
    { id: 'brands', titleKey: 'builder.nav.brands', path: 'brands', icon: 'tag', group: 'builder.navGroup.content' },
    { id: 'templates', titleKey: 'builder.nav.templates', path: 'templates', icon: 'palette', group: 'builder.navGroup.content' },
    { id: 'orders', titleKey: 'builder.nav.orders', path: 'orders', icon: 'package', permission: 'website-builder:orders:read', group: 'builder.navGroup.selling' },
    { id: 'abandoned', titleKey: 'builder.nav.abandoned', path: 'abandoned', icon: 'phone-missed', permission: 'website-builder:orders:read', group: 'builder.navGroup.selling' },
    // AN.1 — first-party traffic. Behind orders:read because the screen shows
    // order counts beside the views; a role that may not read orders may not
    // read how many there were either.
    { id: 'analytics', titleKey: 'builder.nav.analytics', path: 'analytics', icon: 'bar-chart-3', permission: 'website-builder:orders:read', group: 'builder.navGroup.selling' },
    { id: 'delivery-prices', titleKey: 'builder.nav.deliveryPrices', path: 'delivery-prices', icon: 'truck', permission: 'website-builder:settings:write', group: 'builder.navGroup.selling' },
  ],
  status: 'stable',
};

export const erp: ProductManifest = {
  id: 'erp',
  nameKey: 'product.erp.name',
  descriptionKey: 'product.erp.description',
  icon: 'briefcase',
  basePath: '/erp',
  entitlement: 'product.erp',
  permissions: [
    'erp:read',
    'erp:orders:read',
    'erp:orders:write',
    'erp:products:write',
    'erp:products:read',
    'erp:inventory:write',
    // Sensitive (D-05.1): this is every customer's name, phone number, address
    // and lifetime spend. No role grants it implicitly.
    'erp:clients:read',
    // LP.10. Sensitive for the same reason and by the same rule: correcting a
    // customer's address changes where a courier drives, and somebody who may
    // not READ the registry must not be able to WRITE it. It buys the four
    // fields with no reliable automatic source — name, wilaya, commune,
    // address — and never a lifetime counter.
    'erp:clients:write',
    'erp:shipments:write',
    // Sensitive (D-05.1): the company's profit and loss.
    'erp:finance:read',
    'erp:finance:write',
    // Declared in Phase 5.2, when the routes that check them were written.
    // A permission a route uses but the manifest does not declare still works —
    // `productOf` resolves it by prefix — but it is invisible to the shell's
    // navigation filter and to the roles screen, which is how a permission
    // comes to exist that nobody can see or grant.
    'erp:settings:write',
    'erp:audit:read',
    'erp:agents:manage',
    'erp:ai:use',
  ],
  nav: [
    { id: 'overview', titleKey: 'erp.nav.overview', path: '', icon: 'layout-dashboard' },
    // Phase 6.4. The confirmation agent's working screen — the port of
    // apps/erp/agent.html. Second, because for the people who hold
    // `erp:orders:write` and nothing else it is the only screen they use.
    { id: 'queue', titleKey: 'erp.nav.queue', path: 'queue', icon: 'phone-call', permission: 'erp:orders:write', group: 'erp.navGroup.work' },
    { id: 'orders', titleKey: 'erp.nav.orders', path: 'orders', icon: 'clipboard-list', permission: 'erp:orders:read', group: 'erp.navGroup.work' },
    { id: 'clients', titleKey: 'erp.nav.clients', path: 'clients', icon: 'users', permission: 'erp:clients:read', group: 'erp.navGroup.work' },
    { id: 'products', titleKey: 'erp.nav.products', path: 'products', icon: 'box', group: 'erp.navGroup.catalogue' },
    { id: 'inventory', titleKey: 'erp.nav.inventory', path: 'inventory', icon: 'layers', permission: 'erp:inventory:write', group: 'erp.navGroup.catalogue' },
    { id: 'shipments', titleKey: 'erp.nav.shipments', path: 'shipments', icon: 'truck', permission: 'erp:shipments:write', group: 'erp.navGroup.fulfilment' },
    { id: 'carriers', titleKey: 'erp.nav.carriers', path: 'carriers', icon: 'route', permission: 'erp:shipments:write', group: 'erp.navGroup.fulfilment' },
    // LP.15. The channel API has had full CRUD since Phase 5.3c and no
    // nav item, so a tenant could not connect a storefront through the
    // console at all — and the webhook URL, generated on create, was
    // never shown again by anything.
    { id: 'sales-channels', titleKey: 'erp.nav.channels', path: 'sales-channels', icon: 'store', permission: 'erp:settings:write', group: 'erp.navGroup.fulfilment' },
    { id: 'follow-up', titleKey: 'erp.nav.followUp', path: 'follow-up', icon: 'bell-ring', permission: 'erp:orders:write', group: 'erp.navGroup.work' },
    // LP.13. Gated on `erp:orders:read`, which every member holds — deliberately:
    // the rows are RECORD-SCOPED, so an agent gets the analytics of their own
    // queue (their own confirmation rate, which is what they are measured on)
    // and a manager gets the book. The by-agent table needs `erp:agents:manage`
    // and is withheld inside the screen, because a league table of colleagues is
    // supervision data — the same rule LP.6 applies to its `agents` export.
    { id: 'analytics', titleKey: 'erp.nav.analytics', path: 'analytics', icon: 'bar-chart-3', permission: 'erp:orders:read', group: 'erp.navGroup.insight' },
    // LP.16d, merged in LB.25. The calculator (a working sheet syncing from
    // real orders) and the finance screen (the same record restated by hand)
    // both wrote `POST /financial-records`, so the module has ONE screen now,
    // titled Finances. The id and PATH stay `calculator` on purpose: the URL
    // is an address, not a name — the Automation screen set that precedent —
    // and moving it would break links to buy nothing. The one-off expense
    // list and the version history moved onto this screen with the merge.
    { id: 'calculator', titleKey: 'erp.nav.finance', path: 'calculator', icon: 'line-chart', permission: 'erp:finance:read', group: 'erp.navGroup.insight' },
    { id: 'agents', titleKey: 'erp.nav.agents', path: 'agents', icon: 'user-cog', permission: 'erp:agents:manage', group: 'erp.navGroup.admin' },
    { id: 'ai', titleKey: 'erp.nav.ai', path: 'ai', icon: 'sparkles', permission: 'erp:ai:use', group: 'erp.navGroup.admin' },
    // Phase 6.3d. NOT called "settings", and the registry's own test is why:
    // a tenant with N products must still see ONE Settings, owned by the shell,
    // and a product shipping its own is the first step to N of them. The name
    // was the problem rather than the screen — every one of these is a rule the
    // ERP applies on its own (assign, confirm, reassign, suspend, reserve, poll),
    // so "automation" is what it actually is. The stored keys are still
    // ProductSetting rows and the route is still PUT /api/erp/settings.
    { id: 'automation', titleKey: 'erp.nav.automation', path: 'automation', icon: 'settings', permission: 'erp:settings:write', group: 'erp.navGroup.admin' },
  ],
  /* PM.7 — THE QUESTION THIS PRODUCT IS OPENED WITH.
   *
   * A customer rings and says a phone number. Answering it took four
   * navigations — product, order list, open the filter bar, type, submit — on
   * every single call, in a building where that call happens hundreds of times
   * a day. `orderFilters` has read `search` since LP.3 and it reaches the
   * reference, the customer name and the phone number, so the capability was
   * always there and the distance to it was the whole cost.
   *
   * `search`, not `q`: the parameter is the one `orderFilters` already
   * validates, so the box and the list cannot disagree about what was asked.
   * Gated on `erp:orders:read` because a box that submits into a 404 is worse
   * than no box.
   */
  search: {
    path: 'orders',
    param: 'search',
    placeholderKey: 'erp.filters.searchPlaceholder',
    permission: 'erp:orders:read',
  },
  status: 'stable',
};

/**
 * Registration order — this is the order products appear in the app switcher.
 * Neither product is the platform's "main" one, so this list is alphabetical
 * by id rather than ranked, and nothing should read meaning into position.
 */
export const builtInProducts: readonly ProductManifest[] = [erp, websiteBuilder];
