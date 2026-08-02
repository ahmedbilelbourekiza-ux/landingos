import type {
  Entitlements,
  ProductManifest,
  ProductNavItem,
} from './types.ts';

/* =============================================================================
 * The registry. Holds product manifests and answers the questions the shell,
 * the router and billing each need to ask — without any of them knowing which
 * products exist.
 *
 * Validation happens once, at construction, and throws. A malformed manifest
 * is a programming error in a product that is about to be mounted, so the
 * useful moment to fail is boot, loudly, not the first time a user clicks a
 * link into a shadowed route.
 * ========================================================================== */

/**
 * Where every product's console lives.
 *
 * Products sit UNDER this prefix rather than at the URL root, and that is a
 * routing constraint before it is a preference: a tenant storefront is
 * `/<tenant>/<page>` (decision D2), so the root is a dynamic segment. Two
 * dynamic segments cannot share a level — Next rejects it outright with
 * "Ambiguous route pattern /[*]" — and between a customer-facing URL and an
 * internal one, the customer-facing URL keeps the root.
 *
 * A manifest still declares only its OWN segment (`/builder`). The platform
 * decides where products live, so a tenth product never learns this prefix
 * exists, and moving the console somewhere else changes this constant alone.
 *
 * It also shrinks the reserved-slug problem enormously (R-08): tenant slugs no
 * longer share a namespace with product paths, so a company may call itself
 * "builder" or "erp" without breaking anything.
 */
export const CONSOLE_PREFIX = '/console';

/**
 * Paths the platform owns WITHIN the console. A product claiming one of these
 * would shadow a platform screen, and the failure would look like "settings
 * stopped working" rather than "the new product has a bad basePath".
 */
export const RESERVED_BASE_PATHS: readonly string[] = [
  '/api',
  '/login',
  '/logout',
  '/signup',
  '/invite',
  '/settings',
  '/billing',
  '/account',
  '/admin',
  '/_next',
];

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const BASE_PATH_PATTERN = /^\/[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export class ProductRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductRegistryError';
  }
}

export interface ProductRegistry {
  /** Every registered product, in registration order. */
  list(): readonly ProductManifest[];
  get(id: string): ProductManifest | undefined;
  has(id: string): boolean;
  /** Products whose entitlement the tenant holds, in registration order. */
  enabledFor(entitlements: Entitlements): readonly ProductManifest[];
  /** True when the tenant holds this specific product's entitlement. */
  isEnabled(id: string, entitlements: Entitlements): boolean;
  /** The product owning a console pathname, or undefined. */
  resolveByPath(pathname: string): ProductManifest | undefined;
  /** The full console URL for a product, including the platform's prefix. */
  hrefFor(id: string): string | undefined;
  /** A product's nav filtered to what these permissions can see. */
  navFor(
    id: string,
    grantedPermissions: Iterable<string>,
  ): readonly ProductNavItem[];
  /** Every permission declared by every product. For the roles UI. */
  allPermissions(): readonly string[];
}

function validate(manifests: readonly ProductManifest[]): void {
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const seenEntitlements = new Set<string>();

  for (const m of manifests) {
    if (!ID_PATTERN.test(m.id)) {
      throw new ProductRegistryError(
        `product id "${m.id}" must be lowercase kebab-case — it appears in URLs, entitlement keys and permission names`,
      );
    }
    if (seenIds.has(m.id)) {
      throw new ProductRegistryError(`duplicate product id "${m.id}"`);
    }
    seenIds.add(m.id);

    if (!BASE_PATH_PATTERN.test(m.basePath)) {
      throw new ProductRegistryError(
        `product "${m.id}" has basePath "${m.basePath}" — it must be a single lowercase segment with a leading slash and no trailing slash, e.g. "/builder"`,
      );
    }
    if (RESERVED_BASE_PATHS.includes(m.basePath)) {
      throw new ProductRegistryError(
        `product "${m.id}" claims reserved basePath "${m.basePath}", which belongs to the platform and would shadow it`,
      );
    }
    if (seenPaths.has(m.basePath)) {
      throw new ProductRegistryError(
        `basePath "${m.basePath}" is claimed by more than one product — one would silently shadow the other`,
      );
    }
    seenPaths.add(m.basePath);

    if (!m.entitlement) {
      throw new ProductRegistryError(
        `product "${m.id}" declares no entitlement, so nothing could ever grant access to it`,
      );
    }
    if (seenEntitlements.has(m.entitlement)) {
      throw new ProductRegistryError(
        `entitlement "${m.entitlement}" is claimed by more than one product — subscribing to one would silently unlock the other`,
      );
    }
    seenEntitlements.add(m.entitlement);

    const navIds = new Set<string>();
    for (const item of m.nav) {
      if (navIds.has(item.id)) {
        throw new ProductRegistryError(
          `product "${m.id}" has duplicate nav id "${item.id}"`,
        );
      }
      navIds.add(item.id);
      if (item.path.startsWith('/')) {
        throw new ProductRegistryError(
          `product "${m.id}" nav item "${item.id}" has path "${item.path}" — nav paths are relative to basePath and must not start with a slash`,
        );
      }
    }
  }
}

export function createProductRegistry(
  manifests: readonly ProductManifest[],
): ProductRegistry {
  validate(manifests);

  const ordered = [...manifests];
  const byId = new Map(ordered.map((m) => [m.id, m]));

  /* Longest basePath first, so a product at /builder-pro is never shadowed by
   * one at /builder. Single-segment basePaths make this unlikely today, but
   * the ordering costs nothing and removes the class of bug entirely. */
  const byPathLength = [...ordered].sort(
    (a, b) => b.basePath.length - a.basePath.length,
  );

  return {
    list: () => ordered,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),

    enabledFor(entitlements) {
      const held = new Set(entitlements);
      return ordered.filter((m) => held.has(m.entitlement));
    },

    isEnabled(id, entitlements) {
      const m = byId.get(id);
      if (!m) return false;
      return new Set(entitlements).has(m.entitlement);
    },

    resolveByPath(pathname) {
      // Accepts a path with or without the console prefix, so callers that
      // hold a raw request pathname and callers that hold a product-relative
      // one both work without either learning about the prefix.
      const p = pathname.startsWith(CONSOLE_PREFIX)
        ? pathname.slice(CONSOLE_PREFIX.length) || '/'
        : pathname;
      return byPathLength.find((m) => p === m.basePath || p.startsWith(m.basePath + '/'));
    },

    hrefFor(id) {
      const m = byId.get(id);
      return m ? CONSOLE_PREFIX + m.basePath : undefined;
    },

    navFor(id, grantedPermissions) {
      const m = byId.get(id);
      if (!m) return [];
      const granted = new Set(grantedPermissions);
      return m.nav.filter((i) => !i.permission || granted.has(i.permission));
    },

    allPermissions() {
      const all = new Set<string>();
      for (const m of ordered) for (const p of m.permissions) all.add(p);
      return [...all];
    },
  };
}
