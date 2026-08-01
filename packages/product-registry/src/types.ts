/* =============================================================================
 * The product-module contract.
 *
 * LandingOS is a platform that happens to contain two products today. Nothing
 * in the platform may be written as though that number is two — not the
 * navigation, not the routing, not billing, not permissions. A product is
 * therefore not a folder the shell knows about; it is a MANIFEST the shell
 * discovers.
 *
 * The practical test this contract has to pass: adding a tenth product must
 * touch the tenth product's files and nothing else. `test/registry.test.ts`
 * asserts exactly that with a product that does not exist yet.
 *
 * Everything user-visible here is an i18n KEY, never a literal string. The
 * platform ships in Arabic, French and English (decision D4), and a manifest
 * with a hardcoded English name is a manifest that has to be reopened later.
 * ========================================================================== */

/**
 * Lifecycle of a product on the platform.
 *
 * `planned` exists so a product can be declared — and appear in pricing and
 * roadmap surfaces — before any of it is built. Without it, the first thing
 * anyone does with an unfinished product is register it as `stable` and
 * special-case it somewhere.
 */
export type ProductStatus = 'stable' | 'beta' | 'planned';

/** One entry in a product's own navigation. */
export interface ProductNavItem {
  /** Stable, unique within the product. Used as a React key and in telemetry. */
  readonly id: string;
  /** i18n key for the label. Never a literal. */
  readonly titleKey: string;
  /**
   * Path RELATIVE to the product's basePath, with no leading slash.
   * An empty string means the product's index page.
   */
  readonly path: string;
  /** Icon name resolved by the shell's icon registry (lucide today). */
  readonly icon: string;
  /**
   * Permission required to SEE this item. Omitted means every member of the
   * tenant sees it. This is a navigation filter and nothing more — the API
   * that the item links to does its own authorization, because hiding a link
   * has never stopped anybody from typing a URL.
   */
  readonly permission?: string;
}

/** Everything the platform needs to know about a product. */
export interface ProductManifest {
  /**
   * Stable, URL-safe identity. Appears in entitlements, permissions and
   * telemetry, so it is chosen once and never renamed.
   */
  readonly id: string;
  /** i18n keys for the product's display name and one-line description. */
  readonly nameKey: string;
  readonly descriptionKey: string;
  /** Icon name resolved by the shell's icon registry. */
  readonly icon: string;
  /**
   * Where this product's console lives, as an absolute path with a leading
   * slash and no trailing slash — e.g. `/builder`. Must be unique across
   * products and must not collide with a platform route; the registry
   * enforces both, because a duplicate here is a routing bug that shows up
   * as one product silently shadowing another.
   */
  readonly basePath: string;
  /**
   * The billing entitlement that unlocks this product. A tenant holding this
   * key has the product; a tenant without it does not. This is the ONLY
   * mechanism by which a product is enabled, which is what makes "subscribe
   * to any combination" a data question rather than a code question.
   */
  readonly entitlement: string;
  /**
   * Every permission this product defines. Declared here so the roles UI can
   * enumerate permissions without importing a single product's internals.
   */
  readonly permissions: readonly string[];
  /** The product's navigation, in display order. */
  readonly nav: readonly ProductNavItem[];
  readonly status: ProductStatus;
}

/**
 * A tenant's entitlements — the set of keys their subscription grants.
 * Deliberately a plain string collection rather than a richer type: the
 * registry must not know how billing decides what a tenant holds, only what
 * they hold.
 */
export type Entitlements = Iterable<string>;
