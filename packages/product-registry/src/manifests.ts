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
    'builder:read',
    'builder:pages:write',
    'builder:pages:publish',
    'builder:orders:read',
    'builder:settings:write',
  ],
  nav: [
    { id: 'overview', titleKey: 'builder.nav.overview', path: '', icon: 'layout-dashboard' },
    { id: 'pages', titleKey: 'builder.nav.pages', path: 'pages', icon: 'file-text' },
    { id: 'categories', titleKey: 'builder.nav.categories', path: 'categories', icon: 'folder-open' },
    { id: 'templates', titleKey: 'builder.nav.templates', path: 'templates', icon: 'palette' },
    { id: 'orders', titleKey: 'builder.nav.orders', path: 'orders', icon: 'package', permission: 'builder:orders:read' },
    { id: 'abandoned', titleKey: 'builder.nav.abandoned', path: 'abandoned', icon: 'phone-missed', permission: 'builder:orders:read' },
    { id: 'delivery-prices', titleKey: 'builder.nav.deliveryPrices', path: 'delivery-prices', icon: 'truck', permission: 'builder:settings:write' },
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
    'erp:inventory:write',
    'erp:clients:read',
    'erp:shipments:write',
    'erp:finance:read',
    'erp:agents:manage',
    'erp:ai:use',
  ],
  nav: [
    { id: 'overview', titleKey: 'erp.nav.overview', path: '', icon: 'layout-dashboard' },
    { id: 'orders', titleKey: 'erp.nav.orders', path: 'orders', icon: 'clipboard-list', permission: 'erp:orders:read' },
    { id: 'clients', titleKey: 'erp.nav.clients', path: 'clients', icon: 'users', permission: 'erp:clients:read' },
    { id: 'products', titleKey: 'erp.nav.products', path: 'products', icon: 'box' },
    { id: 'inventory', titleKey: 'erp.nav.inventory', path: 'inventory', icon: 'layers', permission: 'erp:inventory:write' },
    { id: 'shipments', titleKey: 'erp.nav.shipments', path: 'shipments', icon: 'truck', permission: 'erp:shipments:write' },
    { id: 'carriers', titleKey: 'erp.nav.carriers', path: 'carriers', icon: 'route', permission: 'erp:shipments:write' },
    { id: 'follow-up', titleKey: 'erp.nav.followUp', path: 'follow-up', icon: 'bell-ring', permission: 'erp:orders:write' },
    { id: 'finance', titleKey: 'erp.nav.finance', path: 'finance', icon: 'line-chart', permission: 'erp:finance:read' },
    { id: 'agents', titleKey: 'erp.nav.agents', path: 'agents', icon: 'user-cog', permission: 'erp:agents:manage' },
    { id: 'ai', titleKey: 'erp.nav.ai', path: 'ai', icon: 'sparkles', permission: 'erp:ai:use' },
  ],
  status: 'stable',
};

/**
 * Registration order — this is the order products appear in the app switcher.
 * Neither product is the platform's "main" one, so this list is alphabetical
 * by id rather than ranked, and nothing should read meaning into position.
 */
export const builtInProducts: readonly ProductManifest[] = [erp, websiteBuilder];
