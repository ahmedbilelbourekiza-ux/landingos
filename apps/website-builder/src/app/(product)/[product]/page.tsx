import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { productRegistry } from "@landingos/product-registry";
import { requireConsoleSession } from "@/lib/console/session";
import { ConsoleShell } from "@/components/console/console-shell";

export const dynamic = "force-dynamic";

/**
 * Every product's console, from ONE route.
 *
 * There is no /builder/page.tsx and no /erp/page.tsx. The segment is resolved
 * against the registry, which is what makes "scales from 2 products to 10+
 * without another redesign" a property of the code rather than a promise in a
 * document. A tenth product ships a manifest; this file does not change.
 *
 * Two gates before anything renders:
 *   - the segment must name a registered product
 *   - the session must be entitled to it AND permitted to open it
 * A tenant that never bought the ERP gets 404 on /erp, not an empty shell.
 */
export default async function ProductHome({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product: segment } = await params;

  const product = productRegistry.resolveByPath(`/${segment}`);
  if (!product) notFound();

  const session = await requireConsoleSession(`/${segment}`);

  // Entitlement and permission both decided in @landingos/auth. Reaching for
  // the URL directly gets the same answer as not seeing the link.
  const permitted = session.products.some((p) => p.id === product.id);
  if (!permitted) notFound();

  const t = await getTranslations();
  const nav = productRegistry.navFor(product.id, session.permissions);

  return (
    <ConsoleShell session={session} productId={product.id}>
      <h1 className="text-xl font-semibold">{t(product.nameKey)}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t(product.descriptionKey)}</p>

      <div className="mt-6 rounded-lg border border-dashed border-border p-6">
        <p className="text-sm text-muted-foreground">
          {/* Deliberately honest placeholder. The builder's screens move onto
              this shell in 4.4; the ERP's first real screen arrives in 4.6. */}
          This product is mounted on the shared shell. Its screens are ported in
          a later milestone.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2" data-testid="nav-preview">
          {nav.map((i) => (
            <li
              key={i.id}
              data-nav={i.id}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
            >
              {t(i.titleKey)}
            </li>
          ))}
        </ul>
      </div>
    </ConsoleShell>
  );
}

/** Static params for the products that exist today; new ones resolve at request time. */
export function generateStaticParams() {
  return productRegistry.list().map((p) => ({ product: p.basePath.slice(1) }));
}
