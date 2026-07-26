// Arabic pluralization for product counts.
// 0 → "لا توجد منتجات"
// 1 → "منتج واحد"
// 2 → "منتجان"
// 3-10 → "X منتجات"
// 11+ → "X منتج"
export function arabicProductCount(count: number): string {
  if (count === 0) return "لا توجد منتجات";
  if (count === 1) return "منتج واحد";
  if (count === 2) return "منتجان";
  if (count >= 3 && count <= 10) return `${count} منتجات`;
  return `${count} منتج`;
}
