"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { TileKey, TilePreferences } from "@/lib/builder/traffic-tiles";

/* =============================================================================
 * TR.2 — "Customize tiles", the Traffic screen's one write control for its
 * own layout.
 *
 * A CLIENT ISLAND WITH SERVER-TRANSLATED WORDS. Every string arrives as a
 * prop, which is this console's convention for write controls: a control
 * never depends on messages being available client-side, and the component
 * cannot become the place an untranslated literal lives.
 *
 * WHAT IT WRITES: the whole preference, every save. The hidden list is sent
 * complete (a checkbox form knows the full state), and a colourable tile's
 * three cut points are sent as numbers or, when all three are blank, as
 * `null` — which is how a merchant turns a colour back OFF without a second
 * endpoint. A half-filled trio is refused by the route, and the message says
 * so, rather than being guessed into a scale.
 *
 * THE DIRECTION IS PRINTED, NOT CHOSEN. "Lower is better" beside a cost is a
 * fact about costs, and letting someone flip it would only ever be a mistake
 * with a colour on it.
 * ========================================================================== */

export interface TileCatalogEntry {
  readonly key: TileKey;
  readonly label: string;
  /** Null for a count or a money total — nothing to set. */
  readonly higherIsBetter: boolean | null;
  /** "%" or the currency, printed after the inputs so a merchant knows the
   * unit they are typing. */
  readonly unit: string;
}

type Trio = { bad: string; almostBad: string; almostGood: string };

export function CustomizeTilesPanel({
  prefs,
  catalog,
  labels,
  errors,
}: {
  readonly prefs: TilePreferences;
  readonly catalog: readonly TileCatalogEntry[];
  readonly labels: {
    readonly title: string;
    readonly hint: string;
    readonly show: string;
    readonly thresholds: string;
    readonly bad: string;
    readonly almostBad: string;
    readonly almostGood: string;
    readonly higher: string;
    readonly lower: string;
    readonly clear: string;
    readonly save: string;
    readonly saving: string;
  };
  readonly errors: ActionErrors;
}) {
  const { run, pending, error } = useApiAction(errors);

  const [shown, setShown] = useState<Set<TileKey>>(
    () => new Set(catalog.map((c) => c.key).filter((k) => !prefs.hidden.includes(k))),
  );
  const [trios, setTrios] = useState<Partial<Record<TileKey, Trio>>>(() => {
    const out: Partial<Record<TileKey, Trio>> = {};
    for (const c of catalog) {
      if (c.higherIsBetter === null) continue;
      const t = prefs.thresholds[c.key];
      out[c.key] = t
        ? { bad: String(t.bad), almostBad: String(t.almostBad), almostGood: String(t.almostGood) }
        : { bad: "", almostBad: "", almostGood: "" };
    }
    return out;
  });

  const toggle = (key: TileKey) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setTrio = (key: TileKey, field: keyof Trio, value: string) =>
    setTrios((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { bad: "", almostBad: "", almostGood: "" }), [field]: value } }));

  const onSave = () => {
    const hidden = catalog.map((c) => c.key).filter((k) => !shown.has(k));
    const thresholds: Record<string, { bad: number; almostBad: number; almostGood: number } | null> = {};
    for (const c of catalog) {
      if (c.higherIsBetter === null) continue;
      const t = trios[c.key] ?? { bad: "", almostBad: "", almostGood: "" };
      const blank = t.bad.trim() === "" && t.almostBad.trim() === "" && t.almostGood.trim() === "";
      thresholds[c.key] = blank
        ? null
        : { bad: Number(t.bad), almostBad: Number(t.almostBad), almostGood: Number(t.almostGood) };
    }
    return run("PUT", "/api/builder/analytics/tiles", { hidden, thresholds });
  };

  const colourable = catalog.filter((c) => c.higherIsBetter !== null);

  return (
    <details data-testid="tiles-customize" className="rounded-lg border border-border bg-surface-raised">
      <summary className="tap flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
        <SlidersHorizontal aria-hidden="true" className="size-4 text-muted-foreground" />
        {labels.title}
      </summary>
      <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
        <p className="text-xs text-muted-foreground">{labels.hint}</p>

        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.show}
          </legend>
          <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={shown.has(c.key)}
                  onChange={() => toggle(c.key)}
                  data-tile-toggle={c.key}
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        {colourable.length > 0 && (
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {labels.thresholds}
            </legend>
            <p className="mt-1 text-xs text-muted-foreground">{labels.clear}</p>
            <div className="mt-2 space-y-2">
              {colourable.map((c) => {
                const t = trios[c.key] ?? { bad: "", almostBad: "", almostGood: "" };
                return (
                  <div
                    key={c.key}
                    className="grid items-center gap-2 sm:grid-cols-[minmax(8rem,12rem)_repeat(3,minmax(0,1fr))_auto]"
                    data-tile-thresholds={c.key}
                  >
                    <span className="text-sm">
                      {c.label}
                      <span className="ms-1.5 text-2xs text-muted-foreground">
                        {c.higherIsBetter ? labels.higher : labels.lower}
                      </span>
                    </span>
                    {(["bad", "almostBad", "almostGood"] as const).map((field) => (
                      <label key={field} className="grid gap-0.5 text-2xs text-muted-foreground">
                        {labels[field]}
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          className="ui-input h-8 text-sm"
                          value={t[field]}
                          onChange={(e) => setTrio(c.key, field, e.target.value)}
                          dir="ltr"
                        />
                      </label>
                    ))}
                    <span className="text-2xs text-muted-foreground" dir="ltr">
                      {c.unit}
                    </span>
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="space-y-2">
          <ActionButton
            type="button"
            onClick={onSave}
            pending={pending}
            pendingLabel={labels.saving}
            data-testid="tiles-customize-save"
          >
            {labels.save}
          </ActionButton>
          <ActionError message={error} />
        </div>
      </div>
    </details>
  );
}
