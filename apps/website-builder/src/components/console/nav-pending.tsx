"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

/* =============================================================================
 * Which navigation you are waiting for — UI.17.
 *
 * THE PROBLEM. Every console page is `export const dynamic = "force-dynamic"`
 * and opens a tenant-bound transaction; the order screen runs a count, a
 * `findMany`, three bounded id queries, a settings read, a membership read, a
 * carrier read and an export count before it can render a single row. Between
 * the click and the paint there was nothing at all — no spinner, no dimming, no
 * change of any kind — so the honest reading of a slow navigation was "the
 * click did not register", and people clicked again.
 *
 * WHY NOT `loading.tsx`. That is the obvious answer and it is wrong HERE.
 * `ConsoleShell` is rendered by each PAGE rather than by the console layout
 * (every screen resolves its own session and passes its own `productId`), so a
 * route-level Suspense fallback would replace the whole frame — the sidebar and
 * the header would blink out on every navigation. A pending state that removes
 * the navigation you are navigating with is worse than none.
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
  if (!pending) return null;
  return (
    <Loader2
      aria-hidden="true"
      className="ms-auto size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
    />
  );
}
