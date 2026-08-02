import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { directionOf, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
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
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
          <Toaster />
          <SonnerToaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
