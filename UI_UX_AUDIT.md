# UI/UX Audit — the LandingOS console

**Measured:** 7 August 2026, from `cc72efe` (master, clean tree).
**Scope:** every console screen, every shared component, every write panel, the
shell, the storefront-adjacent auth pages. `apps/erp` (the legacy SPA) is read
as a reference, not as a target.
**No code was changed while this was written.** That is deliberate and it is the
same discipline `LEGACY_PARITY.md` §0 used: measure first, then decide the
order, then build.

---

## 0. What this pass is for, and what it is not

The platform has reached parity and passed four engineering audits. Every
workflow the legacy ERP had exists here, is contract-tested, and in nine places
is objectively better (LEGACY_PARITY §6.3). **Nothing in this document proposes
changing what the software does.**

What it measures is the layer the parity work deliberately did not: whether an
operator who spends eight hours a day in this console can *see* what the
platform knows, reach it without thinking, and still be reading accurately at
17:00. That is a different question from "does the feature exist", and the
project's own §6.2 already answered part of it honestly — density, hierarchy,
discoverability and feedback were all called out as weaker than the legacy's.
LP.3, LP.7, LP.8 and LP.11 closed the *capability* half of those findings. The
*presentation* half was never a slice.

**The method.** Every `page.tsx` under `src/app/console` was read (39 files,
7,872 lines) plus every component under `src/components/console` (33 files),
`packages/ui/src/tokens.css`, `src/app/globals.css`, `src/app/layout.tsx`, and
the four contract suites that assert on rendered HTML (`screens`, `listing`,
`finance`, `console-shell`). Class usage was counted mechanically rather than
eyeballed — the frequency tables in §2 are `grep | sort | uniq -c` over the
console source, which is why "there are seven vertical rhythms" is a count and
not an impression.

**What it may not trade away.** §10 states the constraints in full. In short:
the D-06 rules, the one-vocabulary rules, the i18n rule, the `data-testid`
surface every contract test reads, tenant scoping, and every permission
predicate that decides whether a control is rendered at all.

---

## 1. Scoreboard

**87 findings.** Severity is operator impact, not effort.

| | Count | Meaning |
|---|---|---|
| 🔴 **Blocking** | 9 | An operator cannot do something, or cannot see something, at all |
| 🟠 **Serious** | 26 | Measurably slower, harder to read, or inaccessible |
| 🟡 **Inconsistent** | 34 | Works, but the product does not look like one product |
| 🔵 **Polish** | 18 | Real, and last |

| Area | 🔴 | 🟠 | 🟡 | 🔵 |
|---|---|---|---|---|
| Shell and navigation | 3 | 6 | 4 | 3 |
| Design system / tokens | 0 | 4 | 9 | 4 |
| Tables | 1 | 6 | 5 | 2 |
| Forms | 1 | 4 | 7 | 2 |
| Feedback (loading/empty/error) | 3 | 2 | 2 | 2 |
| Accessibility | 1 | 4 | 3 | 3 |
| Responsive / mobile | 0 | 0 | 0 | 0 |
| Screens | 0 | 0 | 4 | 2 |

> Responsive shows zero not because it is fine but because its findings are all
> counted in *Shell* — there is one root cause and it is UX-01.

---

## 2. Cross-cutting — the design system that was never assembled

`packages/ui` is a **colour system**, and a good one: brand separated from
status, six tones each with `fg`/`bg`/`border`, both themes, and a contrast test
that fails the build below 4.5:1 (`packages/ui/test/tokens.test.ts`). It is
23 colour decisions.

A design system is roughly nine axes. **Eight of them do not exist**, so every
screen re-decides them, and the counts below are what re-deciding looks like
after 39 screens.

| Axis | State |
|---|---|
| Colour | ✅ Real, tested, both themes |
| Radius | 🟡 One token (`--radius: 0.75rem`), three values used by hand |
| Typography | 🔴 No scale |
| Spacing / rhythm | 🔴 No scale |
| Elevation | 🔴 No tokens; `shadow-lg` appears twice, nowhere else |
| Motion | 🟠 No tokens; `transition-colors` on 2 of 33 components |
| Focus | 🔴 No `:focus-visible` rule anywhere in the codebase |
| Density | 🔴 No concept |
| Layout / container | 🔴 No concept |

### UX-10 🟠 There is no type scale, and the console uses five sizes with two of them arbitrary

Measured across `app/console` + `components/console`:

```
265  text-xs        (0.75rem)   — labels, metadata, most secondary text
222  text-sm        (0.875rem)  — body, controls, section headings
 35  text-xl        (1.25rem)   — every page title
  8  text-2xl                   — dashboard tile figures
  6  text-[10px]                — row badges
  5  text-[11px]                — row sub-lines
```

Three consequences, all measurable:

1. **A section heading is the same size and weight as body text.** `<h2>` on
   every screen is `text-sm font-medium` (28 occurrences). The order detail
   stacks six of them; a reader scanning for "History" is scanning for
   14px medium among 14px regular.
2. **`text-[10px]` and `text-[11px]` are outside any scale** and are used for
   information the row exists to carry — the order type, the overdue tag, the
   note marker, the price breakdown (`orders/page.tsx:239`, `:351`, `:359`,
   `:424`). Ten-pixel type is where an eight-hour reader loses accuracy first.
3. **`text-xl` (20px) is the largest thing on any screen.** There is no visual
   difference between the title of the busiest screen in the building and the
   title of the delivery-price table.

### UX-11 🟠 There is no vertical rhythm, and the gap between two panels is set by whichever child renders it

`mt-1 · mt-2 · mt-3 · mt-4 · mt-6 · mt-8 · mt-10` are all in use — seven
rhythms. Worse than the count is *where the decision lives*: on
`/console/erp/orders` the create panel, the import panel, the filter bar, the
export panel, the bulk bar and the pager each apply their own top margin from
inside their own file. The page composes six components and controls the space
between none of them.

Concretely, `order-create.tsx` opens `mt-4`, `csv-import.tsx` opens `mt-4`,
`FilterBar` opens `mt-4`, `order-export.tsx` opens `mt-4`, `DataTable` opens
`mt-6`, `Pager` opens `mt-4`. Reordering two of them changes the spacing.

### UX-12 🟡 `rounded-lg` and `rounded-md` are used for the same role

75 × `rounded-lg`, 90 × `rounded-md`, 3 × `rounded-xl`, 22 × `rounded-full`.
A panel is `rounded-lg` on the orders screen and `rounded-md` in the
notification list; a button is `rounded-md` everywhere and a filter chip is
`rounded-full`. There is no rule, so there is no reading of the shape.

### UX-13 🟠 `--card` is defined and the console does not use it

`--card: oklch(1 0 0)` — pure white above the warm off-white ground — exists
precisely so a surface can lift off the page without a shadow. The tokens file
says so in its own comment. **`bg-card` appears in the console exactly twice**
(the login and join pages). Every panel on every ERP screen is
`rounded-lg border border-border` on the page ground: an outline, not a surface.
On the dark theme the effect is stronger, because `--card` there is a genuinely
lighter grey and the panels are all rendering at `--background`.

### UX-14 🟡 The same control is styled independently in at least five files

The text input — `rounded-md border border-input bg-background px-3 py-2
text-sm` — is written out by hand in `filter-bar.tsx` (as a local `CONTROL`
const), `queue/page.tsx` (twice, inline), `order-create.tsx`, `edit-field.ts`
consumers, `settings-form.tsx`, `signup-form.tsx`, `join-form.tsx` and the two
auth pages. Nine copies of one decision. Changing the input height is nine
edits and a regression risk in each.

### UX-15 🟠 There are no elevation, motion or focus tokens

- **Elevation:** `shadow-lg` twice (the notification panel and its toast).
  Nothing else in the console is ever raised, including things that overlay
  content.
- **Motion:** `transition-colors` on `ConsoleNav` and on the dashboard tiles.
  Every other hover, disclosure and state change is instant. There is one
  animation in the product (`.row-flash`) and it is correct, including its
  `prefers-reduced-motion` branch — which proves the standard is known and was
  simply never generalised.
- **Focus:** see UX-60.

### UX-16 🔵 `::selection` names two variables that do not exist

`globals.css` sets `background-color: var(--crimson)` and, in dark,
`var(--crimson-light)`. Neither token is defined in `tokens.css` or anywhere
else, so both declarations are invalid and dropped; text selection falls back
to the UA default. Harmless, and it is a live wrong reference in the one
stylesheet everything loads.

---

## 3. Shell and navigation

### UX-01 🔴 There is no navigation at all below 768px

`console-shell.tsx:92`:

```
<aside className="hidden w-64 shrink-0 flex-col border-e … md:flex">
```

The sidebar is `hidden` under `md`, and **nothing replaces it** — no hamburger,
no drawer, no bottom bar, no menu in the header. Below 768px a signed-in
operator has a page, a tenant switcher, a bell and a name, and no way to reach
any other screen except by typing a URL.

This is the single largest defect in the audit and it is aimed at the exact
population the project already identified: LEGACY_PARITY §6.4(c) records that
the legacy agent PWA "is used by field agents on Algerian mobile networks", and
`/console/erp/queue` is the screen ported *from* that PWA. It is reachable on a
phone only by remembering `/console/erp/queue`.

### UX-02 🔴 The dark theme cannot be turned on

`components/shared/theme-toggle.tsx` exists, is complete, and **is imported by
nothing**. `ThemeProvider` is mounted with `defaultTheme="system"`, so the dark
palette appears only if the operating system asks for it and can never be
chosen, previewed or overridden in the product.

The dark theme is not a nicety here. `tokens.css` documents at length that it
*is* the ERP's own palette, promoted — "the dense operational screens people use
every day keep the exact colour language they already read fluently". A call
centre that runs its floor lights low has no way to get it, and the resolution
of risk R-14 is invisible to every user.

### UX-03 🔴 Navigation icons are computed, passed down, and thrown away

The registry declares an `icon` for every nav item. `console-shell.tsx:117-122`
maps it into the props. `ConsoleNav` destructures `{ id, href, title, icon }`
and **renders only `title`** (`console-nav.tsx:20-58`). The ERP's thirteen
items are therefore thirteen lines of 14px text in one undifferentiated column,
and `lucide-react` is already a dependency.

### UX-04 🟠 Thirteen nav items in one flat list, with no grouping

`erp` declares: overview, orders, queue, follow-up, clients, products,
inventory, shipments, carriers, sales-channels, analytics, finance, calculator,
automation, ai. They are one `<ul>`. There is no relationship expressed between
"orders / queue / follow-up" (daily work), "products / inventory" (catalogue),
"shipments / carriers / sales-channels" (integrations) and "analytics / finance
/ calculator" (money) — four groups an operator already holds in their head.

### UX-05 🟠 The header is 56px of mostly nothing, and the page title is inside the scroll area

The header carries a tenant switcher at the start and, at the end, the bell, the
locale switcher and a name. It does not carry: the current page, a breadcrumb,
a search, the primary action, or the theme control. Meanwhile every page renders
its own `<h1>` as the first thing inside `<main>`, so **the title scrolls away**
— on the order detail (653 lines) and the calculator (285) it is gone within one
screen and there is nothing left saying where you are.

### UX-06 🟠 `<main className="min-w-0 flex-1 p-6">` — no container, no responsive padding

- On a 2560px monitor the orders table stretches to ~2300px. The reference
  column and the actions column end up 2.2m apart on a wall display; on the
  order detail the prose in a `<section>` reaches ~180 characters per line
  against a 45–90 optimum.
- At 360px the padding is still 24px on both sides, which is 13% of the
  viewport.
- There is no `max-width` anywhere, and no per-breakpoint padding step.

### UX-07 🟠 Settings and Sign out are in the sidebar footer, styled unlike the navigation above them

`console-shell.tsx:126-134`. Both are `px-3 py-2 text-sm text-muted-foreground`
links with a hover — visually close to a nav item but not one, with no active
state, no icon and no separation from each other. "Sign out" sits immediately
under "Settings" with identical weight: the destructive-adjacent action and the
routine one look the same.

### UX-08 🟡 The product switcher, the tenant switcher and the locale switcher are three different controls

Three `<select>`-ish widgets, three visual treatments, in three places (sidebar
top, header start, header end). A person belonging to two tenants with two
products has to learn which of the three chrome elements changes what.

### UX-09 🟡 The bell is an emoji

`notification-provider.tsx:289` renders `🔔` with `aria-hidden`. It renders at
whatever the platform's emoji font decides, does not inherit colour, and does
not match anything else in the interface. `lucide-react` is installed.

### UX-17 🔵 The workspace name is a hardcoded string in the sidebar

`console-shell.tsx:95` renders the literal `LandingOS`. Every other user-facing
string in the shell is a `t()` key.

### UX-18 🔵 There is no skip link

Keyboard and screen-reader users traverse the tenant switcher, thirteen nav
items, settings and sign out before reaching page content — on every navigation.

### UX-19 🔵 No breadcrumb on any second-level screen

`/console/erp/orders/[id]`, `/console/erp/products/[id]` and
`/console/erp/clients/[id]` each render a bare `← Back` link with different
copy and different placement. The order detail's is at `:287`, the product's is
absent entirely, the client's is present.

---

## 4. Tables — where the operator's day is spent

`components/console/data-table.tsx` is 108 lines and renders every list in the
product. It is clean and it is a 2010-era table.

### UX-20 🔴 Sorting exists in the API and no column header is clickable

`orderSort(params.get("sort"), params.get("dir"))` is read on every request
(`orders/page.tsx:92`) and the vocabulary is validated server-side. There is
**no control anywhere that sets `?sort=` or `?dir=`.** This is exactly the class
of defect the project has caught five times and named — a capability computed,
supported and reachable by nothing. LEGACY_PARITY's own words for it: "a
capability nobody can find is not a capability."

An operator cannot sort the order book by value, by date, or by call count.

### UX-21 🟠 No sticky header

50 rows at ~72px is roughly 3,600px of scroll. By row 12 the column headers are
gone, and the orders table has nine columns of which four are money or counts.
The operator is reading unlabelled numbers.

### UX-22 🟠 No hover state, no row focus, no zebra

`<tr className="border-t border-border">` — that is the entire row treatment.
Tracking one record across nine columns on a wide monitor is done unaided. The
selected state, when a checkbox is ticked, is *nothing at all*: the row does not
change, so a 50-row page with six ticked has no visual answer to "which six".

### UX-23 🟠 No select-all, and the bulk bar's count comes from the DOM

`OrderBulkBar` counts ticked checkboxes. There is no header checkbox, so
"confirm every pending order in Alger from yesterday" — the workflow the filter
bar exists to enable — ends in ticking up to 50 boxes by hand.

### UX-24 🟠 Row density is fixed, and it is the loose one

Cells are `px-4 py-3` with multi-line content: the reference cell renders a link,
a badge row, a channel line and a date line. The order row is four lines tall.
An ERP operator triaging a queue wants 25–30 rows on screen; they get 8.

There is no density control and no compact mode, and the legacy — measured in
§6.2 as carrying 14 facts per row — did this in one line.

### UX-25 🟠 The horizontal scroll container gives no sign it scrolls

`overflow-x-auto` on a `min-w-[640px]` table. On a narrow window the last
columns — which on the orders table are *status* and *actions* — are simply not
visible, with no shadow, no fade, and no indication that they exist.

### UX-26 🟡 The table is not semantically complete

No `scope="col"` on headers, no `<caption>`, no `aria-sort`. A screen reader
navigating the order book announces cell contents with no column association.

### UX-27 🟡 Numeric alignment is per-column opt-in and is missed

`numeric: true` sets `tabular-nums`. It is set on total, calls, price, cost,
stock, variants — and not on the money columns of the finance table
(`finance/page.tsx`), the payroll figures on the agents roster, or the analytics
breakdowns. Money columns that do not use tabular figures do not line up.

### UX-28 🟡 The empty state is one sentence in a dashed box

`data-table.tsx:40-48`. No illustration, no explanation of *why* it is empty
(no rows yet, versus a filter that matched nothing — two different situations
needing two different next actions), and no action. On
`/console/erp/orders?status=cancelled` with no cancelled orders, the operator is
told "No orders yet", which is false.

### UX-29 🟡 Two tables in the product bypass `DataTable` entirely

`settings/delivery-prices/page.tsx:110-130` hand-rolls a `<table>` with its own
`<thead>`, its own paddings and hardcoded English headers. `profit-calculator.tsx`
builds its own grid. Neither picks up any improvement made to the shared one.

### UX-30 🔵 Row actions are not keyboard-reachable in a predictable order

`OrderRowActions` renders up to four controls inline in the last cell. Tab order
walks every control of every row; there is no "actions" menu, no roving
tabindex, and no way to act on a row without tabbing past everything before it.

### UX-31 🔵 The changed-row flash is the only feedback a row ever gives

`.row-flash` is well built. It is also the only thing that ever happens to a row.

---

## 5. Forms

### UX-40 🔴 There is no error → field association anywhere

`ActionError` renders one `role="alert"` paragraph at panel level
(`api-action.tsx:93-105`). No control gets `aria-invalid`, no message is bound
with `aria-describedby`, and on a panel with eleven fields (`order-create.tsx`)
the operator is told *that* something was refused and never *which field*. For a
screen-reader user the error is announced with no context at all.

### UX-41 🟠 Labels are `text-xs text-muted-foreground`

Across the filter bar, the queue filters, the create panels and the settings
forms, the label is the least legible text in the group and the value the most.
That is the correct emphasis for a *filled* form being scanned and the wrong one
for a form being filled — and these are entry forms.

### UX-42 🟠 Required fields are not marked, and validation is server-only

`CreateOrder` requires `client`, `phone`, `price` and `product`. The panel marks
none of them. The first signal is a 422 after a submit, surfaced as one sentence
at the bottom.

### UX-43 🟠 There is no help-text slot, so the explanations live in comments

Several fields carry a real constraint the operator cannot see: `carrierCode`
must match an active carrier or the parcel books to the default; money must be
typed as a decimal; the import panel's commit is disabled until a preview has
run (D-LP.19.2) with no sentence saying so. All of these are explained in source
comments and none on screen.

### UX-44 🟠 Buttons are 30px tall and have no size scale

`ActionButton` is `px-3 py-1.5 text-sm` — about 30px. On a touch device that is
well under the 44px target, and the queue screen is the touch screen. There are
three variants (`default | primary | danger`), no sizes, no icon slot, no
loading spinner (the label is swapped for a "saving" string, which changes the
button's width mid-action).

### UX-45 🟡 Panels open by toggling `hidden`, with no disclosure affordance

D-06.4 is right — the contents must exist in the DOM. But the toggle is a plain
button with a text label and no chevron, no `aria-expanded` in most cases, and
no animation, so a collapsed panel reads as a button that does nothing.

### UX-46 🟡 Four collapsed panels stand between the operator and the order book

`/console/erp/orders` renders, in order: title → create panel → import panel →
filter bar → export panel → bulk bar → table. A manager opening the busiest
screen in the building scrolls past four write surfaces to reach the data.

### UX-47 🟡 Success is silent

D-06.3 (no optimistic UI) is right and it is not the same thing as no feedback.
On success the button un-busies and the server re-renders; nothing confirms
*what happened*. LP.7's toast fires on notifications, which is a different
event — confirming an order raises a notification for somebody else, not for the
person who pressed the button.

### UX-48 🟡 Focus is never moved or restored

Opening a panel does not focus it. Closing it does not restore focus. The
notification panel opens with focus left on the bell.

### UX-49 🟡 The auth pages are a different product

`/console/login`, `/console/signup` and `/console/join/[token]` use `bg-card`,
`rounded-xl` and `text-lg` titles — none of which appear anywhere else — and
`login` renders **six hardcoded English strings** in a product whose default
locale is Arabic.

### UX-50 🟡 Hardcoded English survives in five settings screens

`settings/profile` (9 strings), `settings/store`, `settings/integrations`,
`settings/delivery-prices` (4 table headers), `builder/pages/new` (3 labels),
`builder/orders/[id]` ("History"). The project's own assumption #6 is "every
user-facing string is an i18n key. No literals." The i18n scan added by AUDIT.4
reads `t("literal")` calls — it cannot see a string that never went through
`t()`, which is exactly how these survived.

### UX-51 🔵 `inputmode="decimal"` is a rule the forms follow and nothing enforces

LEGACY_PARITY §5 requires money be entered through `inputmode="decimal"` and
never `type="number"`. It is honoured. It is honoured by hand, in each file.

### UX-52 🔵 No autocomplete hints outside the auth pages

The new-order panel asks for a customer name, phone, wilaya and commune with no
`autocomplete` attributes.

---

## 6. Feedback — loading, empty, error, success

### UX-60 🔴 There is no focus-visible style in the entire codebase

`grep -r "focus-visible" src/` returns nothing. `globals.css` sets
`@apply border-border outline-ring/50` on `*`, which sets a colour for an outline
that is never given a width — so keyboard focus is whatever the browser draws by
default. On the dark theme, against `oklch(0.14 0.005 250)`, that is close to
invisible.

Every rule in this project about keyboard reach — the plain GET forms, the
links-not-buttons pager, the working-before-JavaScript filter bar — was written
so the console could be driven from the keyboard. Nothing shows where the
keyboard is.

### UX-61 🔴 There is no `loading.tsx` anywhere

Every console page is `export const dynamic = "force-dynamic"` and every one of
them opens a tenant-bound transaction and runs between two and eleven queries.
Next.js will stream a loading UI for a route segment that provides one. **No
route provides one**, so every navigation in the console is a dead click
followed by a whole-page swap. On the orders screen that is a count, a
`findMany`, three bounded id queries, a settings read, a membership read, a
carrier read and an export count.

### UX-62 🔴 There is no `error.tsx` and no `not-found.tsx`

A thrown error in any screen shows the Next.js default error page — no shell, no
navigation, no way back. PROJECT_STATE's own known-limitations section records
that a database blip "surfaces as a 500 from a screen"; that is the screen it
surfaces as.

### UX-63 🟠 Empty states do not distinguish "nothing yet" from "nothing matched"

See UX-28. The same string is shown for both, on every list.

### UX-64 🟠 There is no skeleton anywhere, though the primitive exists

`components/ui/skeleton.tsx` is present and unused in the console.

### UX-65 🟡 The notification panel cannot be closed with the keyboard

No Escape handler, no click-outside, no focus trap
(`notification-provider.tsx:307`). It has `role="dialog"` and behaves like a
`<div>` that is sometimes visible.

### UX-66 🟡 Toasts stack bottom-end with no dismiss control

`pointer-events-none` on the container, `pointer-events-auto` on each toast, and
no close button, no pause-on-hover, no action.

### UX-67 🔵 Three toast systems are mounted

`layout.tsx` mounts `<Toaster />` (the shadcn one) **and** `<SonnerToaster />`,
and LP.7 renders its own toast stack in the notification provider. Two of the
three are unused by the console.

### UX-68 🔵 `aria-live` on the toast region is `polite` with `aria-atomic="false"`

Correct for a feed. It is also the only live region in the product — an action's
result is never announced.

---

## 7. Accessibility

### UX-70 🟠 Small text carries meaning

`text-[10px]` badges (order type, overdue, suspicious, note, fake) at
`--danger-fg` on `--danger-bg`. The token pair clears AA at body size; at 10px
it fails WCAG 1.4.3's own definition of large text in the other direction and is
below the practical floor for sustained reading.

### UX-71 🟠 Touch targets

Inline row selects and buttons are 28–32px. The queue screen — a tap-to-dial
surface built from a phone app — has a `tel:` link and a set of result buttons
at the same 30px.

### UX-72 🟠 Disabled controls are communicated by opacity alone

`disabled:opacity-50` on every button, `opacity-40` on the pager's dead arrows.
Opacity is not conveyed to assistive technology; the pager does at least set
`aria-disabled`.

### UX-73 🟠 Heading levels skip and repeat

Every screen is `h1` then a flat run of `h2`s; the order detail nests an `h3`
inside a section whose `h2` is a sibling of a `<p>`, and the calculator has an
`h2` at `mt-8` that is a peer of a `<div>` containing another `h2`.

### UX-74 🟡 Landmarks are incomplete

`<aside>`, `<nav aria-label>`, `<header>` and `<main>` exist in the shell.
`<main>` has no `id`, so the skip link that does not exist would have nothing to
target; no page declares `<section aria-labelledby>`.

### UX-75 🟡 Icon-only controls rely on `title`

The badge tooltips (note text, fake reason, ambiguous-name hint) are `title`
attributes — invisible on touch, unreliable to screen readers, and not
keyboard-reachable.

### UX-76 🟡 `dir="ltr"` is applied correctly and inconsistently

References, phones, dates, tracking numbers and counts are correctly forced LTR.
The finance table's money is not; the analytics tables' figures are not.

### UX-77 🔵 No reduced-motion handling outside `.row-flash`

### UX-78 🔵 No `prefers-contrast` handling

### UX-79 🔵 Form controls have no `:invalid` styling

---

## 8. Screen-by-screen

Only what is specific to a screen; everything above applies everywhere.

| Screen | Finding |
|---|---|
| **Dashboard** (`/console/erp`) | 🟡 UX-80 — six equal tiles in a 3-column grid, in declaration order, with the confirmation rate (the number the business is managed by) as an 11px sub-line under a count. No trend, no period, no comparison. The overdue banner is right and is the only hierarchy on the page. |
| **Orders** | 🟡 UX-81 — nine columns with no width control; the reference cell carries five separate facts stacked vertically, which is the density fix (LP.8) implemented as a stack rather than as a row. |
| **Order detail** | 🟡 UX-82 — 653 lines, eleven sections, one column below `lg`, no in-page navigation, no sticky summary. The status and the actions are 400px apart vertically. |
| **Queue** | 🟠 UX-83 — the screen ported from a phone app is the one screen with no mobile navigation to reach it (UX-01), and its cards are `space-y-4` full-width blocks that on a desktop monitor render one card per 1,000px of width. |
| **Products** | 🟡 UX-84 — three collapsed write panels (create, edit, variants) above the table; the variant editor is a 14KB component behind a text toggle. |
| **Analytics** | 🔵 UX-85 — seven breakdowns rendered as seven identical tables. `recharts` is a dependency; §8 of LEGACY_PARITY confirms neither system has ever had a chart, so this is an addition, not a parity item — noted, not proposed. |
| **Finance / Calculator** | 🔵 UX-86 — the calculator is the most complex screen in the product (26KB component, 285-line page) and has no step structure, no summary rail, and its KPI band is `text-sm`. |
| **Settings** | 🟡 UX-87 — `/console/settings` is a link list; the six settings screens have no shared frame, no sub-navigation, and four of them are in English. |

---

## 9. What the legacy still does better, restated

From §6.1/§6.2, with what has since closed marked:

| | State |
|---|---|
| Reassign from the row | ✅ Closed by LP.8 |
| Filter a list | ✅ Closed by LP.3 |
| Enter a phone order | ✅ Closed by LP.4 |
| Know a new order arrived | ✅ Closed by LP.7 + LP.11 |
| Reach row 51 | ✅ Closed by LP.3 |
| **Sort a list** | 🔴 **Open — UX-20** |
| **See 25 rows at once** | 🟠 **Open — UX-24** |
| **Work on a phone** | 🔴 **Open — UX-01** |
| **Know an action succeeded** | 🟡 **Open — UX-47** |

Every remaining item is presentation. That is the whole thesis of this document.

---

## 10. Constraints — what this work may not touch

Binding on every change that follows. Taken from PROJECT_STATE's *Assumptions
future sessions must preserve*, LEGACY_PARITY §5, and the D-06 rules.

1. **No business logic, no calculations, no API behaviour, no permissions.**
2. **D-06.1** — a control calls the API route. No server actions for product
   writes, no second write path.
3. **D-06.2** — a control is rendered only where the API would accept it,
   decided with the same predicate the route checks. Restyling must not change
   *which* controls render.
4. **D-06.3** — no optimistic UI. Feedback may be added; guessing may not.
5. **D-06.4** — a collapsible panel renders its contents always and toggles
   `hidden`.
6. **Every `data-testid`, `data-*` hook and `name=` attribute survives.**
   Specifically: exactly one `data-order-id` per row (the LP.8 defect the LP.3
   paging tests caught), `data-flash-id` where `row-flash.ts` expects it, and
   the attribute ORDER inside `<a data-testid="queue-dial" data-order-id=…>`,
   which `screens.test.ts:1677` matches positionally.
7. **Every user-facing string is an i18n key, in all three catalogues.** New
   strings included. This is also the chance to close UX-50.
8. **Logical properties only** — `ms-`/`me-`/`ps-`/`pe-`/`border-inline-*`.
   Arabic is the default locale.
9. **Money stays a `Decimal` string**, `inputmode="decimal"`, never a JS number.
10. **Both themes stay in step.** Any token added to `:root` is added to
    `.dark`; `packages/ui/test/tokens.test.ts` parses `:root { … \n}` as a flat
    block, so no nested rule may be introduced inside it.
11. **No new dependencies.** `lucide-react`, `recharts`, `framer-motion`,
    `class-variance-authority`, `tailwind-merge` and the full shadcn set are
    already installed and unused in the console.
12. **Server components stay server components.** The filter bar, the pager and
    the tables work before JavaScript, which is what lets contract tests assert
    the offered vocabulary. Nothing here may be traded for an interaction.

---

## 11. The order of work

Ordered by operator impact per unit of risk, which puts the shared layer first
for the same reason LP.3 came before everything in Tier 1: the primitives are an
architectural dependency of every screen below them.

| Pass | Slice | Closes | Risk |
|---|---|---|---|
| **2** | Design tokens — type scale, spacing, elevation, motion, focus, density; both themes | UX-10…16, 60 | Low — additive tokens |
| **2** | Console primitives — `PageHeader`, `Section`, `Field`, `Button`, `Badge`, `EmptyState`, `Toolbar` | UX-12, 14, 28, 41, 44 | Low — new files |
| **3** | The shell — responsive nav, theme control, icons, grouping, container, skip link, header | UX-01…09, 17, 18, 74 | Medium — one file, every screen |
| **4** | `DataTable` — sticky header, sortable headers wired to `?sort`/`?dir`, density, hover/selected, select-all, scroll affordance, semantics | UX-20…27, 30 | Medium — one file, every list |
| **5** | Forms — `Field` applied, error binding, required marks, help text, focus | UX-40…48, 51, 52 | Medium |
| **3** | Screens — apply the frame to all 39 | UX-80…87, 46, 49, 50 | Low each, wide |
| **6** | Loading, error and empty states per route | UX-61, 62, 63, 64 | Low — new files |
| **6** | Accessibility sweep | UX-70…79, 65 | Low |
| **7** | Final audit | — | — |

**Every slice ends with a build and the affected contract suites**, per the
project's own rule, and the screens suite is the one that matters: it asserts on
rendered HTML and is what will catch a `data-testid` lost to a refactor.

---

## 12. What the work closed, and what it left — measured 7 August 2026

Written after the seven passes, from `248a39f` plus the final polish. The
implementation notes live in `CHANGELOG.md` §UI.1–UI.4; this is the scoreboard
against §1.

### Closed

| | |
|---|---|
| **Shell** | UX-01 (drawer), UX-02 (theme switcher), UX-03 (icon registry), UX-04 (manifest-declared groups), UX-05 (sticky header, `PageHeader`), UX-06 (`max-w-[100rem]`, responsive padding), UX-07, UX-08 (partly — one control vocabulary, still three places), UX-09, UX-17, UX-18, UX-19 |
| **System** | UX-10 (`text-2xs` replaces two arbitrary sizes; `sectionTitle` is semibold), UX-11 (`PageBody` owns the column; ten panel margins removed), UX-12, UX-13 (`bg-surface-raised` on every panel), UX-14 (`.ui-control` — nine copies became one), UX-15, UX-16 |
| **Tables** | UX-20 (sortable headers + 4 tests), UX-21, UX-22, UX-23 (select-all, indeterminate), UX-24 (density), UX-25 (scroll shadows), UX-26, UX-27 (partly), UX-28 (`emptyCopy`) |
| **Forms** | UX-40 (`Field`/`fieldAria`), UX-41 (`.ui-label`), UX-42 (order entry), UX-43 (partly), UX-44, UX-45 (`aria-expanded`), UX-46, UX-47 (`ActionFeedback`), UX-49, UX-50 (partly — see below) |
| **Feedback** | UX-60 (`:focus-visible`), UX-61 (`useLinkStatus` per item — see below for why not `loading.tsx`), UX-62, UX-63, UX-65, UX-66 |
| **A11y** | UX-70 (11px floor), UX-71 (`.tap`), UX-72 (pager), UX-74, UX-77 |
| **Screens** | UX-80, UX-82, UX-83, UX-87 |

### Two defects the passes introduced and the live check caught

Both are recorded because the method is worth more than the fixes, and both are
the argument AUDIT.3 already made — the contract suite was green and the running
page was wrong.

1. **`md:max-h-[calc(100dvh-var(--console-header-h)-13rem)]` emitted nothing.**
   Tailwind reads a space in an arbitrary value as the end of the class, so the
   operators have to be written `_-_`; without them the declaration is
   `calc(100dvh-var(…)-13rem)`, which CSS rejects. The container therefore had
   no height, `position: sticky` had nothing to stick to, and the sticky header
   — the whole point of UX-21 — silently did not work, with the class sitting
   right there in the markup. Three more arbitrary `calc()` values in the
   console had the same shape and were corrected with it.
2. **The header cluster overflowed at 375px.** Bell + theme + locale + name came
   to 319px beside a menu button and a company name, and the page scrolled
   sideways by 16 px — on the width the whole drawer work exists for. The locale
   switcher is withheld below `sm`; it has a permanent home on the profile
   screen and the theme control has none.

### Left open, deliberately

| | Why |
|---|---|
| **UX-50, the residue** | Body copy on `settings/integrations` (webhook and pixel table headers, two descriptive sentences) and `settings/delivery-prices` (one explanatory sentence) is still English. Titles, labels, buttons and the sign-in error are keys. Finishing it means naming ~15 more strings in three catalogues, which is a translation task rather than a design one. |
| **UX-61, `loading.tsx`** | Not added, and the reason is structural: `ConsoleShell` is rendered by each PAGE rather than by `console/layout.tsx`, so a route-level Suspense fallback replaces the whole frame and the sidebar blinks out on every navigation. Moving the shell into the layout is a real refactor — every screen resolves its own session and passes its own `productId` — and it is the right next slice for this. `useLinkStatus` covers the click-to-paint gap in the meantime. |
| **UX-08** | The product, tenant and locale switchers share one control vocabulary now and are still three widgets in three places. Merging them is an information-architecture decision, not a styling one. |
| **UX-29** | `settings/delivery-prices` and the calculator still hand-roll their tables. Both were brought onto the shared header padding and `scope="col"`; neither goes through `DataTable`, because both are edit grids rather than lists. |
| **UX-30** | Row actions are still individually tabbable. A roving-tabindex actions menu is a behaviour change to a control surface D-06.2 governs, and belongs in its own slice. |
| **UX-85** | Analytics is still seven tables. `recharts` is installed and LEGACY_PARITY §8 confirms neither system has ever had a chart, so adding one is a feature, not parity — recorded, not taken. |
| **UX-86** | The calculator has the design system but not a step structure. Its 26 KB component is the largest single client module in the console and restructuring it is a slice of its own. |
| **UX-51, UX-52, UX-73, UX-75, UX-76, UX-78, UX-79** | Polish. None blocks an operator. |

### The rule this work adds

**A Tailwind arbitrary value containing an operator must be verified in the
running page, not in review.** It compiles, it appears in the class list, it
survives every contract test that asserts on HTML — and it produces no CSS. The
two defects above were both found by measuring the live document, which is the
method NEXT_STEPS already records as the fourth pass's contribution.

---

## 13. Phase PM — what a second reading found, measured 7 August 2026

§12 closed this document on the seven UI passes. **This section is a different
measurement**, taken by reading the console again as an operator rather than
against the 87 findings above — and the important thing about it is that almost
nothing it found is in §1.

That is not a failure of §1. §1 asked *can an operator see what the platform
knows, reach it without thinking, and still be reading accurately at 17:00*, and
it answered honestly. What it could not ask — because it measured
PRESENTATION, by declaration, in §0 — is the question underneath: **is the
platform showing what it knows at all?**

### The shape all three of the serious findings share

| Column | Written by | Returned by | Rendered by |
|---|---|---|---|
| `CatalogProduct.image` | `POST`/`PATCH /products` since Phase 5 | `PRODUCT_SELECT`, every caller | **nothing, anywhere** |
| `variants[].image` | `PUT /products/[id]/variants` since LP.18 | `inventoryView` | **nothing, anywhere** |
| `Notification.entity` / `entityId` | six notifiers since M-16 | the API and every SSE frame | `flashEntity` only — which does nothing unless the row is already on your screen |

Each passes `packages/db/test/orphans.test.ts` cleanly, because that suite is a
NAME check: the column is named, in several files. Each is invisible to a
contract test, because the route returns it correctly. Each is invisible to a
UI audit that scores hierarchy, density and contrast, because there is nothing
on screen to score.

**The question that finds them is: for every column an API returns, which SCREEN
renders it?** It is the same shape AUDIT.2 applied to routes ("for every route,
which screen calls it?") and LP.17 applied to nav items, and it is recorded as
PM.11 in `NEXT_STEPS.md`.

### And one that was not the ERP's at all

`GET /api/uploads/[...path]` refused any key that was not a single path segment
— while `POST /api/builder/upload` has written `tenants/<tenantId>/<uuid>.<ext>`
since the platform port. **Every image uploaded through the console 404s unless
the deployment has a public R2 bucket.** Shipped, live, and in the BUILDER's
path rather than the ERP's. Found by uploading a real file through the running
console and asking for it back — the AUDIT.3 method, which is now the fifth
defect it has produced that no test could have.

### What §12's open list looks like now

| | State |
|---|---|
| **UX-80** dashboard | **Superseded.** §8 called it "six equal tiles in declaration order… no trend, no period, no comparison" and scored it 🟡. It was the most serious finding in the document and was scored as the least. Rebuilt in PM.1. |
| **UX-85** analytics has no chart | **Closed differently.** LEGACY_PARITY §8's "neither system has ever had a chart" is no longer true — the DASHBOARD has one, server-rendered from `<div>`s rather than from `recharts` (D-PM.1.2). Analytics itself is still seven tables, and now at least renders them in the shared `Section` with the dashboard's period control. |
| **UX-29** hand-rolled tables | **Partly.** Analytics moved onto `Section`/`Stat`/`StatGrid` and was the last LIST doing its own thing. `settings/delivery-prices` and the calculator still hand-roll, and both are edit grids rather than lists — unchanged reasoning. |
| **UX-72** disabled by opacity alone | **Closed, and it was worse than scored.** §7 marked it 🟠 for assistive technology. The measurement in PM.6 found the other half: `opacity: 0.5` puts a disabled label at the same grey as `--muted-foreground`, so a caption and a dead control were the same colour for everybody. |
| **UX-61** `loading.tsx` | Still open, still structural, still UI.6. |
| **UX-08** three switchers · **UX-30** roving tabindex · **UX-50** residue · **UX-86** calculator | Unchanged. |

### What this document should measure next time

§0 says "nothing in this document proposes changing what the software does",
and that constraint is what produced a 🟡 for the dashboard. A presentation
audit and a product audit are different instruments and the second one was never
run. **PM.9–PM.12 in `NEXT_STEPS.md` are what the second instrument found and
did not have time to fix.**
