// Single source of truth for site-wide metadata. Referenced by the root
// layout, sidebar, footer, and generated landing pages.
export const siteConfig = {
  name: "LandingOS",
  shortName: "LOS",
  description:
    "Internal tool for building high-converting COD product landing pages.",
  // Default origin for local development. Override via NEXT_PUBLIC_SITE_URL
  // in production.
  url: "https://landingos.local",
  version: "0.1.0",
} as const;

export type SiteConfig = typeof siteConfig;
