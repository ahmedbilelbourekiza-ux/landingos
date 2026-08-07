"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/* =============================================================================
 * Saying that it worked — UI.24.
 *
 * THE GAP. D-06.3 says no optimistic UI, and it is right: a confirmed call is
 * money, so nothing guesses. But "do not guess" is not the same instruction as
 * "say nothing", and the console had taken it as one — on success the button
 * un-busied, the server re-rendered, and there was no confirmation of any kind.
 * The only feedback an operator ever got was a REFUSAL. LP.7's toast fires on
 * notifications, which is a different event with a different audience: confirming
 * an order raises a notification for the supervisors, not for the person who
 * pressed the button.
 *
 * This does not violate D-06.3, and the distinction is exact: it fires AFTER the
 * API answered success, so it reports something the server said rather than
 * something a form assumed. It renders no data and changes no list.
 *
 * WHY AN EVENT AND NOT A PROP. Every write panel in this console already calls
 * `useApiAction`, and there are more than twenty of them. Threading a `done`
 * flag through each would be twenty edits that a twenty-first panel would
 * forget — which is how a product ends up with feedback on most of its actions.
 * The hook dispatches; one listener in the shell renders. Every panel gets it,
 * including the ones written after this.
 *
 * `aria-live="polite"` rather than `assertive`: a success confirmation must not
 * interrupt somebody mid-sentence. The refusal path keeps its `role="alert"`,
 * because that one genuinely needs to.
 * ========================================================================== */

export const ACTION_OK_EVENT = "landingos:action-ok";

/** How long the mark stays. Long enough to be seen glancing back at the screen,
 *  short enough not to still be there for the next action. */
const VISIBLE_MS = 2200;

export function ActionFeedback({ label }: { readonly label: string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // A counter rather than a boolean: two saves in quick succession must
    // restart the timer, and `true → true` is not a state change.
    const onOk = () => setShown((n) => n + 1);
    window.addEventListener(ACTION_OK_EVENT, onOk);
    return () => window.removeEventListener(ACTION_OK_EVENT, onOk);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(0), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="action-feedback"
      // Bottom-START, so it never lands under the notification toasts at
      // bottom-END — and inline-start rather than left, so it stays on the
      // opposite corner in Arabic too.
      className="pointer-events-none fixed bottom-4 start-4 z-50"
    >
      {shown > 0 && (
        <div className="flex items-center gap-2 rounded-full border border-(--success-border) bg-(--success-bg) px-3 py-1.5 text-sm font-medium text-(--success-fg) shadow-e2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
          <Check aria-hidden="true" className="size-3.5" />
          {label}
        </div>
      )}
    </div>
  );
}
