// Currency formatting for landing pages. Kept dependency-free so it renders
// identically on server and client (no Intl locale mismatch hydration risk).
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  MAD: "DH",
  DZD: "DA",
  TND: "DT",
  SAR: "SR",
  AED: "AED",
};

export function formatPrice(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol} ${formatted}`;
}

export function discountPercentage(
  price: number,
  oldPrice: number | null,
): number | null {
  if (!oldPrice || oldPrice <= price) return null;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}
