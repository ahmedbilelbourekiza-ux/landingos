import { Truck } from "lucide-react";

/* =============================================================================
 * The announcement bar.
 *
 * Task-1 (24 Aug 2026) — it takes the MERCHANT'S text now. The field existed
 * in storage (`LandingPage.announcement`), in the General section's editor
 * form, and in the editor PREVIEW since the port — but this component
 * hardcoded its line and the template mounted it propless, so an announcement
 * edit published everywhere except the page customers see.
 *
 * `text` unset (null — the merchant never wrote one) keeps the original
 * default line BYTE-FOR-BYTE: every live page today renders it, and silently
 * removing the bar from pages whose merchants never touched the field would
 * be a visible storefront change nobody asked for. Whether "unset" should
 * eventually HIDE the bar instead is a product decision, recorded in the
 * Task-1 report — one line here when taken.
 * ========================================================================== */
export function AnnouncementBar({ text }: { text?: string | null }) {
  return (
    /* --theme-primary-foreground, not text-white — the pair the theme
       contract guarantees. Hardcoded white passes every CURRENT preset (all
       ship dark primaries) but is the LB.51 badge defect one component over:
       an extracted theme with a light primary gets a near-black foreground
       chosen for it, and this bar would have stayed white on light
       (19 Aug sweep). */
    <div style={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-primary-foreground)" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium tracking-wide sm:text-[13px]" dir="rtl">
        <Truck className="size-3.5 shrink-0" style={{ color: "var(--theme-accent)" }} aria-hidden />
        {/* dir="auto" on the merchant's text only: they may write French or
            English in an otherwise-RTL bar; the default line stays Arabic
            under the bar's own rtl. */}
        {text ? <span dir="auto">{text}</span> : <span>توصيل مجاني · الدفع عند الاستلام</span>}
      </div>
    </div>
  );
}
