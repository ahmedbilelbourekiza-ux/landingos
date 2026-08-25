/* =============================================================================
 * What a customer is told when their checkout does not go through.
 *
 * WHY THIS FILE EXISTS. Every server-side checkout error was hardcoded
 * ENGLISH — "That store does not exist.", "Check the form.", "Too many orders
 * from this connection" — and the storefront it lands on is a right-to-left
 * Arabic page whose own form already speaks Arabic ("جاري الإرسال…"). The
 * readiness audit found it; SEC.12 fixes it, because a refusal is the worst
 * possible place to leave a customer reading a language they did not choose.
 *
 * WHY A LOCAL TABLE AND NOT `@landingos/i18n`. That catalogue is the CONSOLE's
 * vocabulary — its namespaces are `erp`, `builder`, `settings`, `team`. The
 * storefront has no namespace there at all and does not use next-intl for
 * customer-facing copy; its strings live in the components. Adding a console
 * namespace for six customer strings would join two vocabularies that are
 * deliberately separate. This is the seam where a real storefront catalogue
 * would go if the storefront is ever translated properly, and it is one file
 * to move when that happens.
 *
 * WHICH LOCALE. The TENANT's, never the caller's. A customer has no locale
 * cookie and no account; the language of the shop is the language of the shop,
 * and it is already on `StorefrontTenant.locale` because the storefront renders
 * in it. An unknown value falls back to Arabic, which is the platform default
 * and what every current store sells in.
 *
 * NO `server-only`: the table is data and the lookup is pure, so the suite
 * imports it directly (the calc.ts rule).
 * ========================================================================== */

/** Every refusal the public checkout can produce. */
export type CheckoutErrorCode =
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "METHOD_UNAVAILABLE"
  | "UNKNOWN_DESTINATION"
  | "UNDELIVERABLE"
  | "CHECKOUT_CONFLICT"
  | "ORDER_REFUSED"
  /* VAR.2 — the chosen combination is out of stock, on a page whose merchant
   * turned enforcement ON. Named rather than folded into NOT_FOUND: the
   * product IS available, one choice within it is not, and the customer can
   * fix it themselves by picking another size. */
  | "OUT_OF_STOCK"
  | "INTERNAL_ERROR";

type Catalogue = Record<CheckoutErrorCode, string>;

/* ORDER_REFUSED is SEC.12's block, and its wording is load-bearing twice over.
 *
 * It never says "you have ordered too many times". Telling a saboteur the rule
 * exists tells him the shape of the limit he has to stay under, and telling a
 * real customer they are suspected is an insult delivered by a machine that is
 * sometimes wrong. It points at a human instead, which is both kinder and
 * correct: the call-centre can take the order in thirty seconds if it is real. */

const AR: Catalogue = {
  RATE_LIMITED: "طلبات كثيرة من هذا الاتصال — يرجى الانتظار بضع دقائق ثم المحاولة مرة أخرى.",
  NOT_FOUND: "هذا المنتج غير متوفر حاليا.",
  INVALID_INPUT: "يرجى التحقق من المعلومات المدخلة.",
  METHOD_UNAVAILABLE: "طريقة التوصيل هذه غير متاحة لهذا المنتج.",
  UNKNOWN_DESTINATION: "يرجى اختيار الولاية.",
  UNDELIVERABLE: "التوصيل غير متوفر إلى هذه الولاية حاليا.",
  CHECKOUT_CONFLICT: "تعذر إتمام الطلب — يرجى تحديث الصفحة والمحاولة مرة أخرى.",
  ORDER_REFUSED: "تعذر إتمام هذا الطلب عبر الموقع. يرجى الاتصال بنا لإتمام طلبكم.",
  OUT_OF_STOCK: "هذا الخيار نفد من المخزون — يرجى اختيار خيار آخر.",
  INTERNAL_ERROR: "تعذر تسجيل الطلب. يرجى المحاولة مرة أخرى.",
};

const FR: Catalogue = {
  RATE_LIMITED: "Trop de commandes depuis cette connexion — patientez quelques minutes puis réessayez.",
  NOT_FOUND: "Ce produit n'est pas disponible.",
  INVALID_INPUT: "Veuillez vérifier les informations saisies.",
  METHOD_UNAVAILABLE: "Ce mode de livraison n'est pas proposé pour ce produit.",
  UNKNOWN_DESTINATION: "Veuillez choisir une wilaya.",
  UNDELIVERABLE: "Nous ne livrons pas encore dans cette wilaya.",
  CHECKOUT_CONFLICT: "La commande n'a pas pu être finalisée — actualisez la page et réessayez.",
  ORDER_REFUSED: "Cette commande n'a pas pu être finalisée en ligne. Merci de nous appeler pour la confirmer.",
  OUT_OF_STOCK: "Cette option est épuisée — veuillez en choisir une autre.",
  INTERNAL_ERROR: "Nous n'avons pas pu enregistrer la commande. Veuillez réessayer.",
};

const EN: Catalogue = {
  RATE_LIMITED: "Too many orders from this connection — wait a few minutes and try again.",
  NOT_FOUND: "That product is not available.",
  INVALID_INPUT: "Please check the details you entered.",
  METHOD_UNAVAILABLE: "That delivery method is not offered for this product.",
  UNKNOWN_DESTINATION: "Please choose a wilaya.",
  UNDELIVERABLE: "We do not deliver to that wilaya yet.",
  CHECKOUT_CONFLICT: "That order could not be completed — refresh the page and try again.",
  ORDER_REFUSED: "This order could not be completed online. Please call us and we will take it for you.",
  OUT_OF_STOCK: "That option is out of stock — please choose another.",
  INTERNAL_ERROR: "We could not place that order. Please try again.",
};

const CATALOGUES: Record<string, Catalogue> = { ar: AR, fr: FR, en: EN };

/** The shop's language, or Arabic when it says something we do not speak. */
export function checkoutMessage(locale: string | null | undefined, code: CheckoutErrorCode): string {
  const catalogue = CATALOGUES[(locale ?? "").toLowerCase()] ?? AR;
  return catalogue[code];
}

/**
 * Exported for the suite: every catalogue must answer for every code, or a
 * refusal falls back to a language the customer did not choose — which is the
 * bug this file exists to remove, reintroduced by omission.
 */
export const CHECKOUT_CATALOGUES = CATALOGUES;
