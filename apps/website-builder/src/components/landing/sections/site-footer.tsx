import { Logo } from "@/components/shared/logo";
import { siteConfig } from "@/config/site";
import type { StorefrontStoreData } from "@/types/landing";

/* Simple footer: brand, a one-line trust reminder, and copyright. No link
 * columns — this is a single-product conversion page, not a corporate site.
 *
 * THE TENANT'S identity, since B4 — it said "© LandingOS. All rights
 * reserved." on every tenant's shop while their socials sat unrendered in
 * StoreSettings. Social links render as text, only the ones that exist:
 * brand icon sets age badly and TikTok has no system icon anyway. */

const SOCIAL_KEYS = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["whatsapp", "WhatsApp"],
  ["telegram", "Telegram"],
] as const;

function socialHref(key: (typeof SOCIAL_KEYS)[number][0], value: string): string {
  // Stored values are whatever the merchant pasted: a full URL passes
  // through; a bare handle/number becomes the platform's canonical link.
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, "");
  switch (key) {
    case "facebook": return `https://facebook.com/${handle}`;
    case "instagram": return `https://instagram.com/${handle}`;
    case "tiktok": return `https://tiktok.com/@${handle}`;
    case "whatsapp": {
      const digits = value.replace(/[^0-9]/g, "");
      return `https://wa.me/${digits.startsWith("0") ? `213${digits.slice(1)}` : digits}`;
    }
    case "telegram": return `https://t.me/${handle}`;
  }
}

export function SiteFooter({ store }: { store?: StorefrontStoreData | null }) {
  const year = new Date().getFullYear();
  const socials = store
    ? SOCIAL_KEYS.flatMap(([key, label]) => {
        const value = store[key];
        return value ? [{ key, label, href: socialHref(key, value) }] : [];
      })
    : [];

  return (
    <footer data-testid="storefront-footer" className="border-t bg-muted/30">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-10 text-center sm:px-6">
        {store ? (
          <span className="font-semibold">{store.name}</span>
        ) : (
          <Logo />
        )}
        <p className="max-w-md text-sm text-muted-foreground">
          {store?.description ?? (store ? null : siteConfig.description)}
        </p>
        {socials.length > 0 && (
          <nav aria-label="Social" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
            {socials.map((s) => (
              <a
                key={s.key}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                data-social={s.key}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                {s.label}
              </a>
            ))}
          </nav>
        )}
        <p className="text-xs text-muted-foreground">
          © {year} {store?.name ?? siteConfig.name}
        </p>
      </div>
    </footer>
  );
}
