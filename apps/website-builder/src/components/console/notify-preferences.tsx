"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import { playFamily } from "@/components/console/notification-sound";
import {
  SOUND_FAMILIES, type NotifyPrefs, type SoundFamily,
} from "@/lib/platform/notify-vocab";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * How I want to be told — LP.11, restoring N4 and N5.
 *
 * A PLATFORM screen, on the profile page, because a notification feed is one
 * per person across every product. Putting it inside the ERP would mean a second
 * copy the day a second product raises anything.
 *
 * EVERY TOGGLE HAS A TEST BUTTON, exactly as the legacy does. A per-type sound
 * preference you cannot hear before saving is a preference nobody sets
 * correctly: the whole point of six signatures is that they are distinguishable,
 * and the only way to know which is which is to play them.
 *
 * THE BROWSER PERMISSION IS ASKED ON A CLICK, NEVER ON LOAD. The legacy calls
 * `Notification.requestPermission()` during start-up, which is what trains
 * people to click Block — and a blocked permission cannot be asked for again by
 * that origin. Here it is requested from the desktop toggle, at the moment
 * somebody has said they want it.
 * ========================================================================== */

export interface NotifyPrefStrings {
  readonly saving: string;
  readonly panel: string;
  readonly hint: string;
  readonly sound: string;
  readonly volume: string;
  readonly desktop: string;
  readonly desktopBlocked: string;
  readonly desktopAsk: string;
  readonly test: string;
  readonly save: string;
  readonly saved: string;
  readonly families: Readonly<Record<SoundFamily, string>>;
}

export function NotifyPreferences({
  errors,
  s,
  initial,
}: {
  readonly errors: ActionErrors;
  readonly s: NotifyPrefStrings;
  readonly initial: NotifyPrefs;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [draft, setDraft] = useState<NotifyPrefs>(initial);
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<string>(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  const setFamily = (f: SoundFamily, on: boolean) =>
    setDraft((d) => ({ ...d, families: { ...d.families, [f]: on } }));

  const save = async () => {
    setSaved(false);
    const { ok } = await run("PUT", "/api/platform/notifications/preferences", draft);
    if (ok) setSaved(true);
  };

  /** Asked here, on a click, and never on page load. See the header. */
  const askDesktop = async () => {
    if (typeof Notification === "undefined") return;
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      // Some browsers only expose the callback form. Nothing to recover.
    }
  };

  return (
    <section
      data-testid="notify-preferences"
      className="mt-8 rounded-lg border border-border p-4"
    >
      <h2 className="text-sm font-medium">{s.panel}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="notify-sound"
          checked={draft.sound}
          onChange={(e) => setDraft((d) => ({ ...d, sound: e.target.checked }))}
          className="h-4 w-4 rounded border-input"
        />
        {s.sound}
      </label>

      <div className="mt-3 flex items-center gap-3">
        <label htmlFor="notify-volume" className="text-xs text-muted-foreground">
          {s.volume}
        </label>
        <input
          id="notify-volume"
          data-testid="notify-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={draft.volume}
          onChange={(e) => setDraft((d) => ({ ...d, volume: Number(e.target.value) }))}
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          {Math.round(draft.volume * 100)}%
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {SOUND_FAMILIES.map((f) => (
          <li key={f} className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid={`notify-family-${f}`}
                checked={draft.families[f] !== false}
                disabled={!draft.sound}
                onChange={(e) => setFamily(f, e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              {s.families[f]}
            </label>
            {/* Plays the DRAFT volume, not the saved one, so the slider means
                something before anybody presses save. */}
            <button
              type="button"
              data-testid={`notify-test-${f}`}
              onClick={() => playFamily(f, draft.volume)}
              className="rounded-md border border-input px-2 py-1 text-xs"
            >
              {s.test}
            </button>
          </li>
        ))}
      </ul>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="notify-desktop"
          checked={draft.desktop}
          onChange={(e) => {
            setDraft((d) => ({ ...d, desktop: e.target.checked }));
            // Ask only when turning it ON, and only when the browser has not
            // already answered. A second prompt for a granted permission is a
            // no-op; one for a denied permission is impossible.
            if (e.target.checked && permission === "default") void askDesktop();
          }}
          className="h-4 w-4 rounded border-input"
        />
        {s.desktop}
      </label>

      {/* Said plainly. A denied browser permission cannot be re-requested by
          this origin, so an operator who wonders why nothing appears needs to
          be told it is their browser and not the setting. */}
      {draft.desktop && permission === "denied" && (
        <p data-testid="notify-desktop-blocked" className="mt-1 text-xs text-muted-foreground">
          {s.desktopBlocked}
        </p>
      )}
      {draft.desktop && permission === "default" && (
        <button
          type="button"
          data-testid="notify-desktop-ask"
          onClick={() => void askDesktop()}
          className="mt-1 rounded-md border border-input px-2 py-1 text-xs"
        >
          {s.desktopAsk}
        </button>
      )}

      <div className="mt-4 flex items-center gap-3">
        <ActionButton
          data-testid="notify-save"
          pending={pending}
          pendingLabel={s.saving}
          onClick={() => void save()}
        >
          {s.save}
        </ActionButton>
        {saved && (
          <span data-testid="notify-saved" className="text-sm text-muted-foreground">
            {s.saved}
          </span>
        )}
      </div>

      <ActionError message={error} />
    </section>
  );
}
