import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LandingPageStatus } from "@/types/landing";

// Status badge with per-state styling. Draft is muted (work-in-progress),
// Published is the live "go" state with a subtle accent, Archived is
// desaturated (shelved). Uses a leading dot so the status reads at a glance
// even when the label is truncated.
const STYLES: Record<
  LandingPageStatus,
  { className: string; dot: string; label: string }
> = {
  DRAFT: {
    className: "border-transparent bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
    label: "Draft",
  },
  PUBLISHED: {
    className:
      "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    label: "Published",
  },
  ARCHIVED: {
    className:
      "border-transparent bg-muted text-muted-foreground/70",
    dot: "bg-muted-foreground/40",
    label: "Archived",
  },
};

export function LandingStatusBadge({ status }: { status: LandingPageStatus }) {
  const style = STYLES[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", style.className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {style.label}
    </Badge>
  );
}
