/* =============================================================================
 * The console's visual vocabulary — UI.6.
 *
 * WHY THIS IS A `.ts` FILE OF STRINGS AND NOT A SET OF COMPONENTS.
 *
 * Both halves of this console need it. `filter-bar.tsx` is a server component,
 * `order-create.tsx` is a client one, and both render the same text input. A
 * value exported from a `"use client"` module is a CLIENT REFERENCE on the
 * server: calling it throws at runtime while the build succeeds, which cost
 * this project a cycle in 6.3b and produced the `edit-field.ts` rule —
 * directive-free module for anything both sides need. This is that rule with a
 * third worked example, and it is why the primitives here are class strings a
 * component composes rather than components a component nests.
 *
 * WHAT IT REPLACES. The audit counted the same text-input declaration written
 * out by hand in nine files, three radii used for one role, seven vertical
 * rhythms, and no focus treatment at all. None of that was carelessness — there
 * was simply nowhere to put the decision, so every screen made it again. This
 * is the somewhere.
 *
 * THE RULES IT ENCODES
 *
 *   1. A surface is `bg-surface-raised`, never the page ground with a border
 *      pretending. `--card` was defined for exactly this and used twice in 39
 *      screens.
 *   2. Radius means depth: `rounded-lg` for a surface, `rounded-md` for a
 *      control inside one, `rounded-full` only for a pill.
 *   3. A label is foreground, not muted. Muted is for the value being
 *      described, never for the thing doing the describing on a form somebody
 *      is FILLING.
 *   4. Nothing sets its own outer margin. Space between blocks belongs to the
 *      container (`stack`), so reordering two panels cannot change the gaps.
 *   5. Every interactive class carries `.tap`, which is a no-op on a mouse and
 *      a 44px minimum on a touch screen.
 *
 * Everything here is presentation. Nothing decides whether a control renders —
 * that is D-06.2's job and it stays in the screens, with the permission the
 * route checks.
 * ========================================================================== */

import { cn } from "@/lib/utils";

/* -----------------------------------------------------------------------------
 * Typography
 *
 * Five roles, and the point of naming them is that a section heading stops
 * being `text-sm font-medium` — the same size AND weight as the body text
 * beside it, which is why a screen with six sections read as one long run.
 * -------------------------------------------------------------------------- */

/** The one `<h1>` on a screen. */
export const pageTitle = "text-xl/tight font-semibold tracking-tight text-foreground";

/** A `<h2>` that opens a region. Weight and colour do the work; size is held
 *  down deliberately, because an operational console is not an article. */
export const sectionTitle = "text-sm font-semibold tracking-tight text-foreground";

/** A `<h3>` inside a region. */
export const subTitle = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** A form label, or a `<dt>`. Foreground — see rule 3. */
export const fieldLabel = "ui-label";

/** Explanatory text under a title or a field. */
export const hint = "text-xs text-muted-foreground";

/** The densest legible step. Replaces `text-[10px]` and `text-[11px]`, which
 *  were outside any scale and carried real information (overdue, flagged,
 *  noted, the price breakdown). */
export const meta = "text-2xs text-muted-foreground";

/** A reference, a phone number, a tracking number. Always `dir="ltr"` at the
 *  call site — the font is only half of it. */
export const mono = "font-mono text-xs";

/* -----------------------------------------------------------------------------
 * Surfaces
 * -------------------------------------------------------------------------- */

/** A card, a panel, a table wrapper — anything content lives ON. */
export const surface = "rounded-lg border border-border bg-surface-raised";

/** Its inner padding. One value, so two panels side by side line up inside as
 *  well as outside. */
export const surfacePad = "p-4 sm:p-5";

/** A strip inside a surface: a table header, a toolbar, a footer. */
export const surfaceHeader = "bg-surface-subtle";

/** A well — read-only output, a preview, a result somebody did not type. */
export const sunken = "rounded-md border border-border bg-surface-sunken";

/** An overlay: a menu, a popover, a toast. The only things allowed a shadow. */
export const overlay = "rounded-lg border border-border bg-surface-raised shadow-e3";

/* -----------------------------------------------------------------------------
 * Rhythm
 *
 * Rule 4. `stack` is the gap between sibling blocks on a page; the numbers are
 * the only three vertical distances the console needs, and having three named
 * ones is what removes the seven ad-hoc ones the audit counted.
 * -------------------------------------------------------------------------- */

/** Between tightly related blocks — a field and its help, a title and its
 *  subtitle. */
export const stackTight = "space-y-2";
/** The default gap between panels on a screen. */
export const stack = "space-y-4";
/** Between unrelated regions — a section boundary. */
export const stackLoose = "space-y-6";

/* -----------------------------------------------------------------------------
 * Controls
 *
 * ONE declaration for every text input, select and textarea in the console.
 * The nine hand-written copies this replaces all agreed on the padding and
 * disagreed about everything else — which is fine until the day one of them
 * needs to change.
 * -------------------------------------------------------------------------- */

/* The declarations are in `globals.css` under `@layer components` — see the
 * comment there for why. These names are the contract; a component composes
 * them and never re-declares the box. */

/** A text, search, date, tel or decimal input. Add `w-full` where it belongs. */
export const control = "ui-control tap";

/** A `<select>`. Same box, platform arrow. */
export const select = "ui-control tap";

/** A `<textarea>`. No `tap` — it is already taller than any touch target. */
export const textarea = "ui-control";

/** A checkbox or radio. Sized up from the browser default, which is 13px and
 *  below every touch guideline there is. */
export const checkbox =
  "h-4 w-4 shrink-0 rounded-sm border-input accent-(--primary) cursor-pointer";

/* -----------------------------------------------------------------------------
 * Buttons
 *
 * Four intents and three sizes, replacing three intents and one size.
 *
 * `ghost` is the addition that matters: a table row needs a control that is
 * legible without drawing a box around itself forty-nine more times, and its
 * absence is why row actions were bordered selects competing with the data.
 * -------------------------------------------------------------------------- */

export type ButtonVariant = "primary" | "default" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_SIZE: Record<ButtonSize, string> = {
  // Dense enough to live in a table row, and `tap` still lifts it to 44px on a
  // touch screen — which is the screen the agent queue is used on.
  sm: "ui-btn-sm",
  md: "",
  lg: "ui-btn-lg",
};

export function button(
  variant: ButtonVariant = "default",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cn("ui-btn tap", `ui-btn-${variant}`, BUTTON_SIZE[size], extra);
}

/** A square button holding only an icon. Needs an `aria-label` at the call
 *  site; there is no such thing as an unlabelled icon control. */
export function iconButton(variant: ButtonVariant = "ghost", size: ButtonSize = "md"): string {
  const square = size === "sm" ? "size-8 px-0" : size === "lg" ? "size-10 px-0" : "size-9 px-0";
  return cn("ui-btn tap", `ui-btn-${variant}`, square);
}

/* -----------------------------------------------------------------------------
 * Links
 * -------------------------------------------------------------------------- */

/** An inline link inside prose or a table cell. */
export const link =
  "underline-offset-2 hover:underline hover:text-foreground transition-colors duration-(--duration-fast)";

/** The identifier a row is opened by — a reference, a tracking number. */
export const idLink = cn(mono, link, "text-foreground");

/* -----------------------------------------------------------------------------
 * Badges
 *
 * A badge says a FACT about a row. `toneVars()` supplies the colour, from the
 * same six tones every status chip uses, so a red badge and a red chip on the
 * same row are the same red.
 * -------------------------------------------------------------------------- */

/** Small, inline, one fact. Pair with `style={toneVars(tone)}` for a tone. */
export const badge =
  "inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-2xs font-medium leading-none";

/** The bigger pill a status renders as. */
export const pill =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium";

/* -----------------------------------------------------------------------------
 * Tables — the classes `DataTable` composes.
 *
 * Exported rather than kept private because two screens hand-roll a table
 * (`settings/delivery-prices`, the calculator's grid) and had no way to look
 * like the shared one.
 * -------------------------------------------------------------------------- */

export const tableWrap = "overflow-x-auto rounded-lg border border-border bg-surface-raised";
export const table = "w-full text-sm";
export const tableHead =
  "sticky top-0 z-10 bg-surface-subtle text-xs font-medium text-muted-foreground";
export const tableHeadCell = "px-3 py-2.5 text-start font-medium whitespace-nowrap";
export const tableRow =
  "border-t border-border transition-colors duration-(--duration-fast) hover:bg-surface-hover " +
  "has-[:checked]:bg-surface-selected";
export const tableCell = "px-3 align-top";

/* -----------------------------------------------------------------------------
 * Panels — a collapsible write surface.
 *
 * D-06.4 requires the contents to exist in the DOM and be toggled with
 * `hidden`, so a contract test can assert the offered vocabulary and assistive
 * tech can reach it before anybody clicks. That rule is untouched; what is
 * added is the affordance, because a toggle with no chevron and no
 * `aria-expanded` reads as a button that does nothing.
 * -------------------------------------------------------------------------- */

export const panelToggle = cn(
  "flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-start",
  "transition-colors duration-(--duration-fast) hover:bg-surface-hover tap",
);

export const panelToggleTitle = "text-sm font-medium text-foreground";

/* -----------------------------------------------------------------------------
 * Layout
 * -------------------------------------------------------------------------- */

/** The page container. A maximum, because at 2560px an order row put its
 *  reference and its actions two metres apart, and the detail screens ran to
 *  180 characters a line against a 45–90 optimum. */
export const pageContainer = "mx-auto w-full max-w-[100rem]";

/** A responsive toolbar row: controls wrap instead of overflowing. */
export const toolbar = "flex flex-wrap items-center gap-2";
