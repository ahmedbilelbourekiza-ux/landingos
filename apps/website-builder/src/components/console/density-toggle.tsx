"use client";

import { useEffect, useState } from "react";
import { Rows2, Rows3 } from "lucide-react";

import { cn } from "@/lib/utils";

/* =============================================================================
 * How many rows fit — UI.13.
 *
 * THE MEASUREMENT. A table cell was `py-3` with multi-line content: the order
 * book's reference cell renders a link, a badge row, a channel line and a date
 * line, so a row was four lines tall and eight of them fit on a laptop. An
 * operator triaging a queue wants twenty-five. The legacy — measured in
 * LEGACY_PARITY §6.2 as carrying FOURTEEN facts per row — did it in one line.
 *
 * WHY IT IS NOT STORED IN THE DATABASE. D-LP.11.1 put the notification
 * preferences on `ProductSetting` rather than in `localStorage`, for two stated
 * reasons: a manager muting an alert on one machine must not be un-muted on the
 * next, and a supervisor must be able to see whether an agent silenced the
 * alarm that watches them. Neither is true of row height. The right density on
 * a 4K desk monitor is the wrong one on a 13" laptop, nobody audits it, and
 * putting it in the database would add a bound read to every console render for
 * a preference that is genuinely per-device.
 *
 * WHY THE ATTRIBUTE IS SET IN A SCRIPT BEFORE PAINT. Reading `localStorage` in
 * an effect means the first paint is always comfortable and then jumps — on
 * every navigation, for the people who chose compact precisely because they are
 * scanning fast. `density-script.tsx` sets it in `<head>`; this control only
 * changes it.
 *
 * This holds no data and decides nothing on the server. It is a viewing
 * preference over rows the server already sent, which is why it is allowed to
 * be client state at all under D-06.3.
 * ========================================================================== */

export const DENSITY_KEY = "landingos.density";

type Density = "comfortable" | "compact";

export function DensityToggle({
  labels,
}: {
  readonly labels: {
    readonly density: string;
    readonly comfortable: string;
    readonly compact: string;
  };
}) {
  const [density, setDensity] = useState<Density | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.density;
    setDensity(current === "compact" ? "compact" : "comfortable");
  }, []);

  const choose = (next: Density) => {
    setDensity(next);
    document.documentElement.dataset.density = next;
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // A browser with storage disabled still gets the change for this page.
      // Failing the click over a persistence problem would be worse than
      // forgetting the choice.
    }
  };

  const options = [
    { value: "comfortable" as const, label: labels.comfortable, Icon: Rows2 },
    { value: "compact" as const, label: labels.compact, Icon: Rows3 },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={labels.density}
      data-testid="density-toggle"
      className="flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          // Before the effect resolves, neither is announced as chosen rather
          // than the wrong one being announced as chosen.
          aria-checked={density === value}
          aria-label={label}
          title={label}
          data-density-option={value}
          onClick={() => choose(value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-[calc(var(--radius)-6px)]",
            "transition-colors duration-(--duration-fast) ease-standard",
            density === value
              ? "bg-surface-selected text-foreground"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
