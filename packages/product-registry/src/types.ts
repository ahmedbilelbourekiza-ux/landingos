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
  /**
   * i18n key for the group this item belongs to in the sidebar. Optional: a
   * manifest that declares none renders one flat list, exactly as before.
   *
   * WHY IT LIVES HERE AND NOT IN THE SHELL. The ERP declares fifteen items and
   * the shell rendered them as fifteen undifferentiated lines, because the only
   * thing that knows "orders, queue and follow-up are the same job" is the
   * product. Putting the grouping in the shell would be the shell knowing what
   * an ERP is — the one thing this contract exists to prevent — and a `switch`
   * on `product.id` is exactly the shape the registry replaced.
   *
   * Items are grouped in DECLARATION ORDER, and an item with no group opens the
   * list ungrouped above the first heading. That keeps "Overview" where it has
   * always been without needing a group called "the top".
   */
  readonly group?: string;
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
  /**
   * The one lookup this product is opened for, if it has one — PM.7.
   *
   * WHY IT IS DECLARED HERE. A customer rings a support desk and says a phone
   * number, and the console's answer was: open the product, open the order
   * list, open the filter bar, type, submit. Four navigations for the single
   * most frequent question anybody asks this software, on every call.
   *
   * A search box in the header fixes that and cannot live in the header's own
   * code, because the header is rendered for EVERY product and the thing being
   * searched is the product's. Putting it there would be the shell knowing what
   * an ERP is — the one thing this contract exists to prevent, and the same
   * argument `ProductNavItem.group` already makes.
   *
   * So the product says where its lookup goes and what to call it, exactly as
   * it says what its navigation contains. A manifest declaring none renders no
   * box, which is what the builder does today.
   */
  readonly search?: ProductSearch;
  readonly status: ProductStatus;
}

/** Where a product's quick lookup submits, and what it is called. */
export interface ProductSearch {
  /**
   * Path RELATIVE to the product's basePath, no leading slash — the screen
   * that already knows how to render results. It is a plain GET form, so the
   * result is a URL somebody can bookmark and hand to a colleague.
   */
  readonly path: string;
  /**
   * The query-string key the destination reads. Named by the product because
   * the product owns the vocabulary its filters are validated against — the
   * shell inventing `?q=` would be a second name for a parameter
   * `orderFilters` already reads as `search`.
   */
  readonly param: string;
  /** i18n key for the placeholder. Never a literal. */
  readonly placeholderKey: string;
  /**
   * Permission required to reach the destination. Omitted means every member.
   * A search box that submits into a 404 is worse than no search box.
   */
  readonly permission?: string;
}

/**
 * A tenant's entitlements — the set of keys their subscription grants.
 * Deliberately a plain string collection rather than a richer type: the
 * registry must not know how billing decides what a tenant holds, only what
 * they hold.
 */
export type Entitlements = Iterable<string>;
