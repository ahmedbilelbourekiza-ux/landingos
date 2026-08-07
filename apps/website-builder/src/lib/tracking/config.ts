/* =============================================================================
 * The provider catalogue (LB.5) — what can be configured, and what each field
 * means per provider. Directive-free: the platform route validates against it
 * and the console screen renders from it, so the two cannot disagree about
 * what a valid GA4 measurement id looks like.
 *
 * Adding a provider here makes it CONFIGURABLE; adding an adapter in
 * `providers/` (+ one line in dispatch.ts SENDERS) makes it fire server-side;
 * a browser snippet in the storefront loader makes it fire client-side. The
 * three are deliberately separable — GTM has no server half and never will.
 * ========================================================================== */

export interface TrackingProviderSpec {
  readonly id: string;
  readonly name: string;
  /** What `publicId` is called for this provider, and how it must look. */
  readonly publicIdLabel: string;
  readonly publicIdPattern: RegExp;
  readonly publicIdHint: string;
  /** What `serverToken` is called; null = this provider has no server side. */
  readonly serverTokenLabel: string | null;
  readonly supportsTestCode: boolean;
  /** Non-secret extra fields carried in `settings`. */
  readonly settingsFields: readonly { key: string; label: string; required: boolean }[];
}

export const TRACKING_PROVIDERS: readonly TrackingProviderSpec[] = [
  {
    id: "meta",
    name: "Meta (Facebook & Instagram)",
    publicIdLabel: "Pixel ID",
    publicIdPattern: /^\d{5,20}$/,
    publicIdHint: "digits only, from Events Manager",
    serverTokenLabel: "Conversions API access token",
    supportsTestCode: true,
    settingsFields: [],
  },
  {
    id: "tiktok",
    name: "TikTok",
    publicIdLabel: "Pixel code",
    publicIdPattern: /^[A-Z0-9]{10,40}$/i,
    publicIdHint: "from TikTok Events Manager",
    serverTokenLabel: "Events API access token",
    supportsTestCode: true,
    settingsFields: [],
  },
  {
    id: "ga4",
    name: "Google Analytics 4",
    publicIdLabel: "Measurement ID",
    publicIdPattern: /^G-[A-Z0-9]{4,16}$/i,
    publicIdHint: "G-XXXXXXXXXX",
    serverTokenLabel: "Measurement Protocol API secret",
    supportsTestCode: false,
    settingsFields: [],
  },
  {
    id: "gtm",
    name: "Google Tag Manager",
    publicIdLabel: "Container ID",
    publicIdPattern: /^GTM-[A-Z0-9]{4,12}$/i,
    publicIdHint: "GTM-XXXXXXX",
    serverTokenLabel: null,
    supportsTestCode: false,
    settingsFields: [],
  },
  {
    id: "google-ads",
    name: "Google Ads conversion tracking",
    publicIdLabel: "Conversion ID",
    publicIdPattern: /^AW-\d{6,15}$/i,
    publicIdHint: "AW-XXXXXXXXX",
    serverTokenLabel: null,
    supportsTestCode: false,
    settingsFields: [
      { key: "conversionLabel", label: "Conversion label (for the Purchase conversion)", required: true },
    ],
  },
] as const;

export const TRACKING_PROVIDER_IDS = TRACKING_PROVIDERS.map((p) => p.id);

export function trackingProvider(id: string): TrackingProviderSpec | undefined {
  return TRACKING_PROVIDERS.find((p) => p.id === id);
}
