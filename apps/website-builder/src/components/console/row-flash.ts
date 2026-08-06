/* =============================================================================
 * The changed row flashes — LP.8, closing N22.
 *
 * The legacy CRM animates `hl-flash` for three seconds on whichever row or card
 * just moved, on the list and on the board. The platform re-rendered and marked
 * nothing: an operator watching a list of fifty orders while a colleague
 * confirms one, or a carrier webhook lands, saw the page change and had no way
 * to tell WHAT changed. On a screen that refreshes by itself (LP.7's debounced
 * `router.refresh()`) that is worse than it sounds — the update is invisible
 * unless you happened to be reading the one row.
 *
 * NO DIRECTIVE, and imported only from `"use client"` modules. It touches the
 * DOM, so it can never run on the server; marking it `"use client"` would make
 * its exports client REFERENCES rather than functions, which is the trap
 * recorded in `edit-field.ts` and paid for once already in 6.3b.
 *
 * IT MARKS, IT DOES NOT MERGE. Nothing here writes a value into a cell — that
 * would be the second copy of the truth D-06.3 forbids. The row's contents come
 * from the server re-render; this only says "look here".
 * ========================================================================== */

/** How long the highlight lasts. Three seconds, as the legacy's animation. */
const FLASH_MS = 3000;

/** How often to look for a row that has not been re-rendered yet. */
const RETRY_MS = 120;

/**
 * How many times to look before giving up.
 *
 * Bounded on purpose: a notification about an order on page 4 of the list will
 * never find a row, and a retry loop with no ceiling would keep a timer alive
 * for the life of the tab. 20 × 120 ms ≈ 2.4 s, comfortably longer than LP.7's
 * 500 ms refresh debounce plus a server render.
 */
const MAX_TRIES = 20;

/**
 * Highlight the row carrying `data-flash-id`, retrying until it exists.
 *
 * The retry is what makes this work for somebody ELSE's change: the
 * notification arrives, `flashEntity` is called, and the row it names is still
 * the pre-refresh one — or, on a list that has just been re-sorted, not mounted
 * yet at all. Looking once would flash the stale row or nothing.
 */
export function flashEntity(id: string | null | undefined, tries = MAX_TRIES): void {
  if (!id || typeof document === "undefined") return;

  // `CSS.escape` because an id is data. Every id this project mints is a cuid,
  // but the argument arrives from a notification payload and a selector built
  // by concatenation is a selector somebody else can write.
  const selector = `[data-flash-id="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id}"]`;
  const el = document.querySelector<HTMLElement>(selector);

  if (!el) {
    if (tries > 0) setTimeout(() => flashEntity(id, tries - 1), RETRY_MS);
    return;
  }

  // Removing, forcing a reflow and re-adding restarts an animation that is
  // already running. Without the reflow the browser coalesces the two class
  // changes and a second event on the same row produces no visible flash at
  // all — which is exactly the case a burst of carrier events creates.
  el.classList.remove("row-flash");
  void el.offsetWidth;
  el.classList.add("row-flash");
  setTimeout(() => el.classList.remove("row-flash"), FLASH_MS);
}
