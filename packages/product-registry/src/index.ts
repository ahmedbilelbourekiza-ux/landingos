export type {
  Entitlements,
  ProductManifest,
  ProductNavItem,
  ProductStatus,
} from './types.ts';

export {
  createProductRegistry,
  ProductRegistryError,
  RESERVED_BASE_PATHS,
  type ProductRegistry,
} from './registry.ts';

export { builtInProducts, erp, websiteBuilder } from './manifests.ts';

import { createProductRegistry } from './registry.ts';
import { builtInProducts } from './manifests.ts';

/**
 * The platform's registry, built from the products that ship today.
 *
 * Constructed eagerly so a malformed manifest fails at import rather than at
 * first use — a duplicate basePath should stop a deploy, not surface later as
 * one product mysteriously shadowing another.
 */
export const productRegistry = createProductRegistry(builtInProducts);
