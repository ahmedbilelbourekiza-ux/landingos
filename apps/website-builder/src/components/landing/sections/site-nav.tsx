import Link from "next/link";

import type { StorefrontStoreData } from "@/types/landing";

/* Minimal navigation for the landing page: just the brand mark. Public COD
 * pages are single-purpose — every link is a distraction from the form — so
 * the nav stays deliberately empty except for identity.
 *
 * THE TENANT'S identity, and no longer only "since B4 when a settings row
 * exists". The platform wordmark used to be the fallback here, which meant a
 * tenant with no StoreSettings row shipped a customer-facing page branded
 * `LandingOS` and LINKING TO `/` — the platform's own console. Both production
 * tenants had exactly that null row when this was measured, so the fallback
 * was not a rare edge. There is no platform fallback any more: `store.name` is
 * resolved server-side and always carries the merchant's own name.
 *
 * The brand is a LINK only when there is somewhere sensible to go. In the
 * editor's preview drawer `homePath` is null and this renders as plain text,
 * because a live link inside a preview navigates the merchant out of the
 * editor they are working in. */
export function SiteNav({ store }: { store?: StorefrontStoreData | null }) {
  if (!store) return null;

  const inner = (
    <>
      {store.logo && (
        // A plain img, deliberately: the logo is tenant-uploaded content
        // of unknown dimensions, and next/image needs configured sizes.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={store.logo}
          alt=""
          data-testid="store-logo"
          className="h-8 w-auto max-w-32 object-contain"
        />
      )}
      <span className="truncate">{store.name}</span>
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {store.homePath ? (
          <Link
            href={store.homePath}
            data-testid="store-brand"
            className="inline-flex items-center gap-2.5 font-semibold text-foreground"
          >
            {inner}
          </Link>
        ) : (
          <span
            data-testid="store-brand"
            className="inline-flex items-center gap-2.5 font-semibold text-foreground"
          >
            {inner}
          </span>
        )}
      </div>
    </header>
  );
}
