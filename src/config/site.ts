// Single source of truth for site-wide metadata. Referenced by the root
// layout, sidebar, footer, and (later) generated landing pages.
export const siteConfig = {
  name: "LandingOS",
  shortName: "LOS",
  description:
    "Internal tool for building high-converting COD product landing pages.",
  // Placeholder; set to the production origin when deployed.
  url: "https://landingos.local",
  version: "0.1.0",
} as const;

export type SiteConfig = typeof siteConfig;
