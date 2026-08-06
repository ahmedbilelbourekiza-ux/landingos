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
    'website-builder:settings:write',
  ],
  nav: [
    { id: 'overview', titleKey: 'builder.nav.overview', path: '', icon: 'layout-dashboard' },
    { id: 'pages', titleKey: 'builder.nav.pages', path: 'pages', icon: 'file-text' },
    { id: 'categories', titleKey: 'builder.nav.categories', path: 'categories', icon: 'folder-open' },
    { id: 'templates', titleKey: 'builder.nav.templates', path: 'templates', icon: 'palette' },
    { id: 'orders', titleKey: 'builder.nav.orders', path: 'orders', icon: 'package', permission: 'website-builder:orders:read' },
    { id: 'abandoned', titleKey: 'builder.nav.abandoned', path: 'abandoned', icon: 'phone-missed', permission: 'website-builder:orders:read' },
    { id: 'delivery-prices', titleKey: 'builder.nav.deliveryPrices', path: 'delivery-prices', icon: 'truck', permission: 'website-builder:settings:write' },
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
    { id: 'queue', titleKey: 'erp.nav.queue', path: 'queue', icon: 'phone-call', permission: 'erp:orders:write' },
    { id: 'orders', titleKey: 'erp.nav.orders', path: 'orders', icon: 'clipboard-list', permission: 'erp:orders:read' },
    { id: 'clients', titleKey: 'erp.nav.clients', path: 'clients', icon: 'users', permission: 'erp:clients:read' },
    { id: 'products', titleKey: 'erp.nav.products', path: 'products', icon: 'box' },
    { id: 'inventory', titleKey: 'erp.nav.inventory', path: 'inventory', icon: 'layers', permission: 'erp:inventory:write' },
    { id: 'shipments', titleKey: 'erp.nav.shipments', path: 'shipments', icon: 'truck', permission: 'erp:shipments:write' },
    { id: 'carriers', titleKey: 'erp.nav.carriers', path: 'carriers', icon: 'route', permission: 'erp:shipments:write' },
    { id: 'follow-up', titleKey: 'erp.nav.followUp', path: 'follow-up', icon: 'bell-ring', permission: 'erp:orders:write' },
    // LP.13. Gated on `erp:orders:read`, which every member holds — deliberately:
    // the rows are RECORD-SCOPED, so an agent gets the analytics of their own
    // queue (their own confirmation rate, which is what they are measured on)
    // and a manager gets the book. The by-agent table needs `erp:agents:manage`
    // and is withheld inside the screen, because a league table of colleagues is
    // supervision data — the same rule LP.6 applies to its `agents` export.
    { id: 'analytics', titleKey: 'erp.nav.analytics', path: 'analytics', icon: 'bar-chart-3', permission: 'erp:orders:read' },
    { id: 'finance', titleKey: 'erp.nav.finance', path: 'finance', icon: 'line-chart', permission: 'erp:finance:read' },
    // LP.16d. The legacy served this as a standalone HTML file with no
    // authorization on the page at all; here it is its own screen behind the
    // same SENSITIVE permission the books are behind. It is beside Finance
    // rather than inside it because it is a working tool, not a report — the
    // thing a manager opens to decide whether a product line survives.
    { id: 'calculator', titleKey: 'erp.nav.calculator', path: 'calculator', icon: 'calculator', permission: 'erp:finance:read' },
    { id: 'agents', titleKey: 'erp.nav.agents', path: 'agents', icon: 'user-cog', permission: 'erp:agents:manage' },
    { id: 'ai', titleKey: 'erp.nav.ai', path: 'ai', icon: 'sparkles', permission: 'erp:ai:use' },
    // Phase 6.3d. NOT called "settings", and the registry's own test is why:
    // a tenant with N products must still see ONE Settings, owned by the shell,
    // and a product shipping its own is the first step to N of them. The name
    // was the problem rather than the screen — every one of these is a rule the
    // ERP applies on its own (assign, confirm, reassign, suspend, reserve, poll),
    // so "automation" is what it actually is. The stored keys are still
    // ProductSetting rows and the route is still PUT /api/erp/settings.
    { id: 'automation', titleKey: 'erp.nav.automation', path: 'automation', icon: 'settings', permission: 'erp:settings:write' },
  ],
  status: 'stable',
};

/**
 * Registration order — this is the order products appear in the app switcher.
 * Neither product is the platform's "main" one, so this list is alphabetical
 * by id rather than ranked, and nothing should read meaning into position.
 */
export const builtInProducts: readonly ProductManifest[] = [erp, websiteBuilder];
