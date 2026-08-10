import { MessageCircle } from "lucide-react";

/* The floating WhatsApp button — CAPABILITY_AUDIT B2. `floatingWhatsapp` had
 * been a stored toggle with no component since the port; this is the missing
 * half. The number comes from Settings → Store (StoreSettings.whatsapp) via
 * the storefront page's own query — the template never reads settings itself.
 *
 * wa.me wants international digits without "+": a local 0X… number becomes
 * 213X… (this platform's market is Algeria); anything already international
 * passes through. A number that normalises to nothing renders nothing.
 *
 * `bottom-24` clears the sticky buy bar; `end-4` keeps it on the trailing
 * edge in BOTH directions (R-10). WhatsApp's brand green is deliberate — the
 * button is recognisable or it is pointless — and sits outside the theme
 * tokens the way the brand icons in the footer would. */

export function normalizeWhatsappNumber(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const intl = digits.startsWith("0") ? `213${digits.slice(1)}` : digits;
  return intl.length >= 9 ? intl : null;
}

export function FloatingWhatsapp({ number }: { number: string }) {
  const intl = normalizeWhatsappNumber(number);
  if (!intl) return null;

  return (
    <a
      href={`https://wa.me/${intl}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="WhatsApp"
      data-testid="floating-whatsapp"
      className="fixed bottom-24 end-4 z-40 flex size-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
      style={{ backgroundColor: "#25D366", color: "#fff" }}
    >
      <MessageCircle className="size-6" aria-hidden />
    </a>
  );
}
