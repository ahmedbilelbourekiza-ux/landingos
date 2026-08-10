"use client";

import { useEffect } from "react";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

import { publishNavPending } from "./content-pending";

/* =============================================================================
 * Which navigation you are waiting for — UI.17, extended by UI.6.
 *
 * THE PROBLEM. Every console page is `export const dynamic = "force-dynamic"`
 * and opens a tenant-bound transaction; the order screen runs a count, a
 * `findMany`, three bounded id queries, a settings read, a membership read, a
 * carrier read and an export count before it can render a single row. Between
 * the click and the paint there was nothing at all — no spinner, no dimming, no
 * change of any kind — so the honest reading of a slow navigation was "the
 * click did not register", and people clicked again.
 *
 * WHY NOT `loading.tsx`. The original reason (the shell was rendered per page,
 * so a route fallback would blink the whole frame away) died with UI.6, which
 * moved the shell into the segment layouts. The reason that SURVIVES is the
 * status-code contract: a `loading.tsx` streams the response, and a streamed
 * response cannot 404 — see content-pending.tsx, which is where this link's
 * pending bit now also goes so the content area can show the next screen's
 * shape while the nav item spins.
 *
 * `useLinkStatus` answers the narrower and more useful question: not "is
 * something loading" but "is THIS link the one you are waiting for". The
 * spinner appears on the item that was clicked, in place, and the rest of the
 * console stays exactly where it was.
 *
 * It must be a descendant of the `<Link>` it reports on, which is why it is a
 * component rather than a hook call in `ConsoleNav`.
 * ========================================================================== */

export function NavPending() {
  const { pending } = useLinkStatus();

  // UI.6 — mirror this link's pending state into the shared store that drives
  // the content-area skeleton. The effect's cleanup is the decrement, so a
  // navigation that commits, fails or is superseded all release it the same
  // way.
  useEffect(() => {
    if (!pending) return;
    return publishNavPending();
  }, [pending]);

  if (!pending) return null;
  return (
    <Loader2
      aria-hidden="true"
      className="ms-auto size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
    />
  );
}
