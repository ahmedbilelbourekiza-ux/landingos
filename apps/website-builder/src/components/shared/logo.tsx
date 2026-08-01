import Link from "next/link";
import { cn } from "@/lib/utils";

// LandingOS wordmark with a geometric mark. Pure SVG/CSS — no asset dependency,
// scales crisply, and adapts to theme via currentColor.
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn(
        "group inline-flex items-center gap-2.5 font-semibold text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className="relative grid size-7 place-items-center rounded-md bg-foreground text-background"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="size-4 transition-transform duration-300 group-hover:scale-110"
        >
          <path
            d="M3 12V4M8 12V6.5M13 12V8M3 12.5h10"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {showWordmark && (
        <span className="text-[15px] tracking-tight">
          Landing<span className="text-muted-foreground">OS</span>
        </span>
      )}
    </Link>
  );
}
