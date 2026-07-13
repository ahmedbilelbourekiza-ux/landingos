import * as React from "react";

// Shared presentational building blocks for the Profile page. Kept in a
// separate file so the page route stays under the 300-line page-size budget.

export function SectionCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
    </section>
  );
}

export function InfoRow({
  icon: Icon,
  label,
  value,
  tone,
  dir,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "ok" | "warning";
  dir?: "ltr" | "rtl";
}) {
  const toneClasses =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-500"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-500"
        : "text-foreground";
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background/40 p-3">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className={`text-sm font-medium ${toneClasses}`} dir={dir}>
        {value || "—"}
      </span>
    </div>
  );
}

// Arabic-friendly date formatter. Uses the user's locale (Africa/Casablanca)
// and the Gregorian calendar with Arabic month names. Falls back to a plain
// ISO slice when Intl is unavailable.
export function formatArabicDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("ar-MA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Casablanca",
    }).format(d);
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}
