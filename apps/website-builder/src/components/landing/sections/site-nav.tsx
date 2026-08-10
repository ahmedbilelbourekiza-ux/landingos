import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import type { StorefrontStoreData } from "@/types/landing";

/* Minimal navigation for the landing page: just the brand mark. Public COD
 * pages are single-purpose — every link is a distraction from the form — so
 * the nav stays deliberately empty except for identity.
 *
 * THE TENANT'S identity, since B4: this page is their shop, and it rendered
 * the platform's wordmark (linking to "/", which is not even their store)
 * for as long as the template existed. The platform mark remains only as the
 * fallback for a tenant with no store settings row at all. */
export function SiteNav({ store }: { store?: StorefrontStoreData | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {store ? (
          <Link
            href={store.homePath}
            data-testid="store-brand"
            className="inline-flex items-center gap-2.5 font-semibold text-foreground"
          >
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
          </Link>
        ) : (
          <Logo />
        )}
      </div>
    </header>
  );
}
