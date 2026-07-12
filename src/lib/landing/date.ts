// Date formatting for the CMS. Uses a fixed, locale-independent format so
// the table never shows inconsistent dates across environments, and so the
// "Recently Updated" sort aligns with what the admin sees in the column.

export function formatDate(iso: string): string {
  const d = new Date(iso);
  // "Jul 10, 2026" — compact and unambiguous.
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Relative "x ago" for the Updated column. Falls back to absolute date past
// 7 days so the column stays informative rather than reading "3 weeks ago".
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso);
}
