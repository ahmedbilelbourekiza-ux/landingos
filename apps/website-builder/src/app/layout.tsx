import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale } from "next-intl/server";
import { directionOf, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import "./globals.css";
import { siteConfig } from "@/config/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} — ${siteConfig.description}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  // Internal admin tool — never indexed.
  robots: { index: false, follow: false },
  icons: { icon: "/logo.svg" },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Resolved by src/i18n/request.ts, so the rule lives in exactly one place.
  const resolved = await getLocale();
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE;
  // `dir` was previously absent and `lang` hardcoded to "en", so the whole
  // application declared itself English left-to-right — which meant Arabic
  // rendered LTR no matter what the copy said. Setting it once here is what
  // lets every component below use CSS logical properties instead of
  // branching on direction (R-10).
  const dir = directionOf(locale);

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        {/* NO client providers here — JS.1, the same reason the PWA manifest
            moved to the console layout (Phase 6.6e): this layout also serves
            the public STOREFRONT, and every provider mounted here rides to a
            customer's phone. Measured before the move: next-intl's client
            runtime + the ICU message-format chunk, next-themes, and BOTH
            toast systems were shipping on every landing page, while the
            storefront uses none of them — zero client translation calls,
            zero toasts, and next-themes' `.dark` stamping is the exact
            behaviour LB.26/LB.30 built theme scopes to defeat. They mount in
            `console/layout.tsx` now; a future provider belongs there unless
            a CUSTOMER-facing surface genuinely consumes it. */}
        {children}
      </body>
    </html>
  );
}
