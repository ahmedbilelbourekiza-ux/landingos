"use client";

import { useEffect, useSyncExternalStore } from "react";

/* =============================================================================
 * Route-level loading states without `loading.tsx` — UI.6.
 *
 * THE OBVIOUS ANSWER IS WRONG FOR THIS CODEBASE. A `loading.tsx` is a Suspense
 * boundary, and a Suspense boundary means the response STREAMS: status 200 and
 * the shell flush first, the page resolves after. Every screen-level
 * `notFound()` — an unbought product, a permission-gated screen, another
 * tenant's record id — would then arrive too late to set a status, and the
 * suites pin dozens of those as real 404s because "confirming it exists is
 * itself information". A skeleton is not worth an information-disclosure
 * channel.
 *
 * So the pending state is CLIENT-side instead. Next already knows exactly
 * which navigation is in flight — `useLinkStatus` inside every nav link (see
 * nav-pending.tsx) — and this store lifts that one bit out of the link so the
 * shell's content area can answer it. No click interception, no heuristics:
 * the same signal that spins the nav item hides the stale screen.
 *
 * A COUNTER, not a boolean: the rail and the drawer render the same links, a
 * second click can overlap a first, and the store must stay truthful when two
 * publishers disagree — it reads "pending" while ANY link is.
 * ========================================================================== */

let pendingCount = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const isPending = () => pendingCount > 0;
const serverSnapshot = () => false;

/** Called by NavPending while its link's navigation is in flight. */
export function publishNavPending(): () => void {
  pendingCount++;
  notify();
  return () => {
    pendingCount = Math.max(0, pendingCount - 1);
    notify();
  };
}

export function useNavPending(): boolean {
  return useSyncExternalStore(subscribe, isPending, serverSnapshot);
}

/**
 * The shell's content area. While a navigation is pending it swaps the
 * outgoing screen for `skeleton` — the shape of the next one — and swaps back
 * the moment the router commits (the new screen, or the 404/redirect the
 * server answered instead). The children stay MOUNTED while hidden: they are
 * the current route's live tree, and unmounting them would discard state the
 * navigation might never replace (a failed transition keeps you where you
 * are).
 */
export function ContentPending({
  skeleton,
  children,
}: {
  readonly skeleton: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  const pending = useNavPending();

  // Scroll to the top when the skeleton appears, matching where the incoming
  // screen will land — a skeleton viewed from 2,000px down is a blank page.
  useEffect(() => {
    if (pending) window.scrollTo({ top: 0 });
  }, [pending]);

  return (
    <>
      <div hidden={pending}>{children}</div>
      {pending && <div aria-busy="true">{skeleton}</div>}
    </>
  );
}
