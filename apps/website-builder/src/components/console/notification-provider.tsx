"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { toneVars } from "@landingos/ui";

import { flashEntity } from "@/components/console/row-flash";
import { playFamily } from "@/components/console/notification-sound";
import { soundFamilyOf, type NotifyPrefs } from "@/lib/platform/notify-vocab";

/* =============================================================================
 * The notification consumer — LP.7, closing N2, N3, L1 and L2.
 *
 * M-16 built the whole transport in three slices: storage with the audience
 * decided ONCE at write time, a live SSE stream with exact replay from
 * `Last-Event-ID`, Web Push, a service worker — and **33 contract tests**. None
 * of it had a consumer. There was no bell, no badge, no panel and no toast, so a
 * signed-in operator was never told anything: not that an order arrived, not
 * that a parcel came back, not that a follow-up escalated. It was the largest
 * piece of dead machinery in the repository.
 *
 * -----------------------------------------------------------------------------
 * IT OWNS THREE THINGS AND NOTHING ELSE
 *
 *   1. THE UNREAD BADGE, whose count is the SERVER'S. `unread` is a prop, read
 *      by `unreadCount()` in the shell on every render. It is deliberately not
 *      an in-memory counter incremented per arriving event: that counter is
 *      wrong the moment a second tab marks something read, wrong after a
 *      reconnect that replays, and wrong for anything raised while the tab was
 *      closed — which is the exact defect the M-16 audit found in the ERP.
 *
 *   2. A TOAST per LIVE arrival. Replayed events (`replayed: true`) do not
 *      toast: they are the catch-up for a connection that dropped, and fifty
 *      toasts on reconnect is noise that hides the one that matters. They still
 *      count toward the badge and still appear in the panel.
 *
 *   3. A DEBOUNCED `router.refresh()`. This is the whole live-console story and
 *      the whole performance story. A carrier replaying a backlog produces
 *      dozens of events in a second and each `router.refresh()` re-renders a
 *      server tree that runs real queries, so they collapse into one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: merge an arriving notification into a list
 * on screen. That would be a second copy of the truth living in the browser, and
 * D-06.3 exists because a confirmed call is money. The server re-renders and the
 * screen shows what the database actually holds.
 *
 * ONE SUBSCRIPTION PER SESSION, NOT PER SCREEN. This lives in
 * `console-shell.tsx`, which every console page renders. A provider per screen
 * would be N streams per tab, and each stream is a polling query.
 *
 * IT IS NOT ERP-SHAPED. `/api/platform/notifications` is a platform surface —
 * one feed per person across every product — so a row carries its `product` and
 * the toast says which one raised it.
 * ========================================================================== */

/** How long a burst is allowed to collapse into one server re-render. */
const REFRESH_DEBOUNCE_MS = 500;
/** How long a toast stays before it removes itself. */
const TOAST_MS = 6000;
/** How many toasts may stack. Beyond this the oldest goes. */
const MAX_TOASTS = 3;

export interface NotificationStrings {
  readonly title: string;
  readonly open: string;
  readonly close: string;
  readonly empty: string;
  readonly markAllRead: string;
  readonly unreadLabel: string;
  readonly live: string;
  readonly reconnecting: string;
  readonly loading: string;
}

interface Feed {
  readonly id: string;
  readonly product: string;
  readonly type: string | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly entity: string | null;
  readonly entityId: string | null;
  readonly read: boolean;
  readonly createdAt: string;
}

export function NotificationProvider({
  unread,
  strings: s,
  productNames,
  prefs,
}: {
  /** The server's count, re-read on every render of the shell. */
  readonly unread: number;
  readonly strings: NotificationStrings;
  /** Product id → translated name, so a toast can say where it came from
   *  without the client holding a registry or a catalogue of strings. */
  readonly productNames: Readonly<Record<string, string>>;
  /* LP.11 — HOW THIS PERSON WANTS TO BE TOLD, read on the SERVER.
   *
   * A prop rather than a fetch, for the reason the unread count is one: the
   * shell reads it on every render, so a change made on the settings screen or
   * in another tab takes effect on the next navigation rather than never. */
  readonly prefs: NotifyPrefs;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Feed[] | null>(null);
  const [toasts, setToasts] = useState<Feed[]>([]);
  const [connected, setConnected] = useState(false);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* The stream subscription is opened ONCE and its handler closes over
   * whatever `prefs` was at that moment. A ref keeps the handler reading the
   * current value without re-opening the connection every time the shell
   * re-renders — which would drop and replay the stream on every navigation. */
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  /** One re-render for a burst, not one per event. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    // `EventSource` reconnects by itself and sends `Last-Event-ID`, which the
    // stream honours exactly — so nothing raised during a drop is lost. That is
    // why this is an EventSource and not a fetch loop.
    const source = new EventSource("/api/platform/notifications/stream");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (event) => {
      let payload: (Feed & { type?: string; replayed?: boolean }) | null = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        // A malformed frame must not kill the stream. The ERP's BUG-04 was
        // exactly this: one bad frame and the whole EventSource died silently.
        return;
      }
      if (!payload) return;

      // The handshake frame carries no id and is not a notification.
      if (!event.lastEventId) {
        if (payload.type === "connected") setConnected(true);
        return;
      }

      if (!payload.replayed) {
        setToasts((current) => [...current, payload as Feed].slice(-MAX_TOASTS));
        /* LP.8 / N22 — MARK THE ROW THE EVENT IS ABOUT.
         *
         * A live notification names an entity, and a screen that refreshes by
         * itself is a screen where a change is invisible unless you happened to
         * be reading that row. `flashEntity` retries until the row exists, so
         * the highlight survives the 500 ms refresh below re-rendering the
         * table underneath it — and does nothing at all when the entity is not
         * on this screen, which is most of the time.
         *
         * Live only. A replayed backlog would flash twenty rows at once, which
         * is the same noise the replay-does-not-toast rule above exists to
         * prevent. */
        flashEntity(payload.entityId);

        /* LP.11 / N4 — THE SOUND IS THE CHANNEL, NOT DECORATION.
         *
         * In a call centre nobody watches the screen: an operator is on the
         * phone with their eyes on a customer's address. Six signatures, so the
         * sound itself says what happened — money arrived, a colleague may be
         * marking orders confirmed without dialling, somebody is waiting for a
         * call back. Live arrivals only, for the reason replayed frames do not
         * toast: fifty sirens on reconnect is not information.
         *
         * The family falls back to a neutral chime for an unmapped type rather
         * than to silence — a notification type added later must be audible by
         * default, which is the safe direction. */
        const family = soundFamilyOf(payload.type);
        if (prefsRef.current.sound && prefsRef.current.families[family] !== false) {
          playFamily(family, prefsRef.current.volume);
        }

        /* LP.11 / N5 — THE DESKTOP NOTIFICATION.
         *
         * Only when the tab is NOT visible. A browser notification for a page
         * the person is looking at duplicates the toast beside it, and the
         * legacy raised both unconditionally.
         *
         * TAGGED BY ENTITY, as the legacy tags by order id: six carrier events
         * for one parcel should replace each other in the tray rather than
         * stack six deep.
         *
         * Permission is never REQUESTED here. Asking on page load is what
         * trains people to click Block, and a blocked permission cannot be
         * asked for again — the settings panel asks, on a click, where the
         * person has just said they want it. */
        if (
          prefsRef.current.desktop &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted" &&
          typeof document !== "undefined" &&
          document.visibilityState !== "visible"
        ) {
          try {
            new Notification(payload.title || payload.type || payload.product, {
              body: payload.body ?? undefined,
              tag: payload.entityId ?? payload.type ?? undefined,
            });
          } catch {
            // A worker-only Notification constructor, a locked-down browser.
            // Never fatal: the toast and the badge still happened.
          }
        }
      }
      // Both live and replayed events move the server truth, so both refresh.
      scheduleRefresh();
      // The panel, if it happens to be open, is refetched rather than patched.
      setItems(null);
    };

    return () => {
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [scheduleRefresh]);

  /** Toasts remove themselves. Deliberately by identity rather than by index —
   *  a second arriving while one is expiring must not dismiss the wrong one. */
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((current) => current.slice(1)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const load = useCallback(async () => {
    const res = await fetch("/api/platform/notifications?limit=50", {
      credentials: "same-origin",
    });
    const envelope = await res.json().catch(() => null);
    if (!res.ok || !envelope?.success) {
      setItems([]);
      return;
    }
    const rows = envelope.data.items as Feed[];
    setItems(rows);

    // Read up to the NEWEST ROW ACTUALLY DISPLAYED, never "everything": a
    // notification arriving between this render and the click would otherwise be
    // swallowed unseen. The route clamps it too — see `markRead`.
    const newest = rows[0]?.id;
    if (newest && rows.some((r) => !r.read)) {
      await fetch("/api/platform/notifications/read", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upToId: newest }),
      });
      router.refresh();
    }
  }, [router]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const label = (n: Feed) => n.title || n.type || n.product;

  return (
    <>
      <div className="relative">
        <button
          type="button"
          data-testid="notification-bell"
          aria-label={s.title}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggle}
          className="relative rounded-md border border-input px-2 py-1.5 text-sm"
        >
          <span aria-hidden="true">🔔</span>
          {unread > 0 && (
            <span
              data-testid="notification-badge"
              data-unread={unread}
              className="ms-1 rounded-full px-1.5 text-xs font-semibold"
              style={toneVars("danger")}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          <span className="sr-only">
            {s.unreadLabel}: {unread}
          </span>
        </button>

        {open && (
          <div
            role="dialog"
            aria-label={s.title}
            data-testid="notification-panel"
            className="absolute end-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-background p-3 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{s.title}</h2>
              <span
                className="text-xs text-muted-foreground"
                data-testid="notification-connection"
                data-connected={connected}
              >
                {connected ? s.live : s.reconnecting}
              </span>
            </div>

            {items === null ? (
              <p className="mt-3 text-xs text-muted-foreground">{s.loading}</p>
            ) : items.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground" data-testid="notification-empty">
                {s.empty}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {items.map((n) => (
                  <li
                    key={n.id}
                    data-testid="notification-item"
                    data-notification-id={n.id}
                    data-product={n.product}
                    className={`rounded-md border border-border p-2 text-sm ${
                      n.read ? "opacity-60" : ""
                    }`}
                  >
                    <p className="font-medium">{label(n)}</p>
                    {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {productNames[n.product] ?? n.product}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              data-testid="notification-close"
              onClick={() => setOpen(false)}
              className="mt-3 w-full rounded-md border border-input px-3 py-1.5 text-sm"
            >
              {s.close}
            </button>
          </div>
        )}
      </div>

      {/* Announced, not just shown. An operator whose attention is on the phone
          is exactly who this feature is for. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        data-testid="notification-toasts"
        className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-72 flex-col gap-2"
      >
        {toasts.map((n) => (
          <div
            key={n.id}
            data-testid="notification-toast"
            data-notification-id={n.id}
            className="pointer-events-auto rounded-lg border border-border bg-background p-3 text-sm shadow-lg"
          >
            <p className="font-medium">{label(n)}</p>
            {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {productNames[n.product] ?? n.product}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
