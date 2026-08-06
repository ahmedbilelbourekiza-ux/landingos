import { type NextRequest } from "next/server";

import { withTenant } from "@landingos/db";

import { apiError } from "@/lib/api/route";
import { getConsoleSession } from "@/lib/console/session";
import { since, newestNotificationId } from "@/lib/platform/notifications";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The live notification stream — M-16, part 2.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS ROUTE DOES NOT USE `tenantRoute`.
 *
 * `tenantRoute` wraps its handler in `withTenant`, and `withTenant` is an
 * INTERACTIVE TRANSACTION — it pins a database connection for as long as the
 * handler runs. An SSE handler runs for as long as the browser tab is open. Ten
 * agents with the console open would hold ten connections open all day, against
 * a pool sized for requests that last milliseconds, and the symptom would be
 * "Can't reach database server" everywhere else.
 *
 * So the session is resolved here and each poll opens its OWN short binding. The
 * cost is a little duplication of what `tenantRoute` does; the alternative is an
 * outage that looks like a flaky database.
 *
 * -----------------------------------------------------------------------------
 * WHY IT POLLS THE DATABASE RATHER THAN FANNING OUT IN PROCESS.
 *
 * The ERP kept `channel -> Set<writer>` in module memory and wrote to it
 * directly. That is correct for exactly one process, and its own changelog says
 * so: "on the single instance this deploys to that is correct, but behind more
 * than one instance each keeps its own count… the fix at that point is Redis".
 *
 * This platform is explicitly built for more than one instance — that is the
 * whole argument of M-15. An in-process fan-out here would deliver a
 * notification only to the agents whose tab happens to be connected to the
 * instance that served the write, and the failure would be invisible: everybody
 * else simply never hears, exactly as if the event had not happened.
 *
 * Polling the table is correct on one instance and on ten, needs no new
 * infrastructure, and makes replay exact rather than best-effort — "everything
 * after id N" is a query, not a buffer that may have been evicted. The cost is
 * one indexed query per connected client per interval, and the honest upgrade
 * path when that stops being cheap is Postgres `LISTEN`/`NOTIFY`, which needs a
 * dedicated non-pooled connection. Recorded in NEXT_STEPS.
 *
 * -----------------------------------------------------------------------------
 * REPLAY.
 *
 * An SSE connection drops constantly in normal use — a phone locking, a tunnel
 * timing out, a redeploy — and `EventSource` reconnects silently with a
 * `Last-Event-ID` header. Every notification raised in that window used to be
 * lost from the live feed and, because nothing read the table, lost entirely.
 * `?lastEventId=` covers a client that reconnects by opening a fresh EventSource
 * instead of letting the browser do it.
 * ========================================================================== */

/** How often each connected client asks for anything new. */
const POLL_MS = Math.max(1000, Number(process.env.NOTIFICATION_POLL_MS) || 5000);
/** A comment frame, because proxies and mobile networks drop idle connections. */
const KEEPALIVE_MS = 25_000;

export async function GET(req: NextRequest) {
  const session = await getConsoleSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (!session.auth) {
    return apiError(403, "NO_ACTIVE_TENANT", "Choose a company before using this feature.");
  }

  const tenantId = session.auth.tenantId;
  const userId = session.user.id;

  // The browser's own header wins; the query parameter is for a client that
  // reconnects by hand. Both are just "the last id I saw" — and neither can
  // widen what is returned, because the query is pinned to this user.
  const headerId = req.headers.get("last-event-id");
  const queryId = new URL(req.url).searchParams.get("lastEventId");
  let cursor = "";
  for (const candidate of [headerId, queryId]) {
    if (candidate && /^\d+$/.test(candidate)) cursor = candidate;
  }
  const resumed = Boolean(cursor);

  /* A FRESH SUBSCRIPTION STARTS AT NOW, NOT AT THE BEGINNING — LP.7.
   *
   * An empty cursor used to mean "send everything", so the first poll delivered
   * this account's whole backlog flagged as LIVE. It was invisible while nothing
   * consumed the stream; the moment a provider toasted live arrivals, every page
   * load produced a burst of toasts for old news.
   *
   * A client with no `Last-Event-ID` has just been server-rendered with the
   * current state and is subscribing for what happens NEXT. History is one
   * `GET /api/platform/notifications` away, which is what the panel does. A
   * client that DID present a cursor is untouched — replay from it stays exact.
   */
  if (!resumed) {
    try {
      cursor = await withTenant(tenantId, (db) => newestNotificationId(db, userId));
    } catch (error) {
      // Starting from the beginning would be worse than starting slightly late,
      // but neither is worth failing the connection over: the next tick catches
      // up from wherever the cursor ends up.
      console.error("[notifications] could not resolve the starting cursor", error);
    }
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The client went away between the check and the write.
          closed = true;
        }
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        if (keepalive) clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      send(`data: ${JSON.stringify({ type: "connected", replayFrom: cursor || null })}\n\n`);

      /** One pass: everything newer than the cursor, oldest first. */
      const drain = async (replayed: boolean) => {
        if (closed) return;
        try {
          const rows = await withTenant(tenantId, (db) => since(db, userId, cursor));
          for (const row of rows) {
            cursor = row.id;
            send(
              `id: ${row.id}\ndata: ${JSON.stringify({ ...row, replayed })}\n\n`,
            );
          }
        } catch (error) {
          // A database blip must not kill the stream: the next tick retries, and
          // the cursor has not moved, so nothing is skipped.
          console.error("[notifications] stream poll failed", error);
        }
      };

      // Anything missed while disconnected, flagged so a client can tell a
      // replay from a live event and de-duplicate by id.
      // Only a RESUMED connection has anything to catch up on. A fresh one
      // was just given the current state by the page it is on.
      if (resumed) await drain(true);

      timer = setInterval(() => void drain(false), POLL_MS);
      keepalive = setInterval(() => send(": ping\n\n"), KEEPALIVE_MS);

      req.signal.addEventListener("abort", stop);
      // Belt and braces: an aborted request that never fires the event.
      if (req.signal.aborted) stop();
    },

    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Stops reverse proxies buffering the stream into uselessness.
      "x-accel-buffering": "no",
    },
  });
}
