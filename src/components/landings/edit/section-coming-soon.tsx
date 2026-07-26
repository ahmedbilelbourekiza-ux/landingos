import { Wrench } from "lucide-react";

// Placeholder body for sections whose editing UI hasn't been built yet.
// Every section card renders this today; as real forms land in future tasks,
// each section swaps this out for its actual inputs. The component is kept
// deliberately calm — a single icon and two lines — so the workspace reads
// as "intentionally minimal" rather than "broken."
export function SectionComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-xl border bg-muted/30 text-muted-foreground/70"
      >
        <Wrench className="size-5" strokeWidth={1.5} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Coming Soon</p>
        <p className="text-xs text-muted-foreground/70">
          This section will be available in a future update.
        </p>
      </div>
    </div>
  );
}
