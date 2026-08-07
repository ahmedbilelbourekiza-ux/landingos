import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import * as s from "./styles";

/* =============================================================================
 * The console's structural primitives — UI.7.
 *
 * NO DIRECTIVE, NO HOOKS, DELIBERATELY. Every component here is a pure render
 * over its props, so a server component can use it and a `"use client"` module
 * can import it into the browser bundle. That is the same property
 * `edit-field.ts` and `notify-vocab.ts` have and the same reason: the write
 * panels are client components and the screens around them are not, and both
 * render page headers, sections, fields and empty states.
 *
 * WHAT THESE ARE FOR. The audit found 35 screens each rendering their own
 * `<h1 className="text-xl font-semibold">` with no place to put a description,
 * an action or a breadcrumb — so descriptions went missing, actions ended up
 * wherever the JSX happened to allow, and every second-level screen invented a
 * different back link. Naming the pattern is what makes the answer the same on
 * screen 36.
 *
 * WHAT THEY ARE NOT. None of them decides whether anything renders. Visibility
 * is D-06.2's job — the permission the ROUTE checks, evaluated in the screen —
 * and a primitive that took a `permission` prop would be a second place that
 * rule lives.
 *
 * Every string is a prop. Nothing here calls `t()`, so nothing here can end up
 * as the one component holding an untranslated literal.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * PageHeader
 * -------------------------------------------------------------------------- */

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

/**
 * The top of every screen.
 *
 * `actions` sits opposite the title on one line and drops beneath it when the
 * two cannot share a row — which is the behaviour a toolbar needs and the
 * reason primary actions previously ended up below a filter bar.
 *
 * `breadcrumb` replaces three different hand-written back links (the order
 * detail's `← Back to list`, the client detail's, and the product detail's
 * absence). The last crumb is the current page and carries no href, because a
 * link to where you already are is a control that does nothing.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  meta,
  id = "page-title",
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly breadcrumb?: readonly Crumb[];
  /** Chips, status pills, counts — anything that qualifies the title itself. */
  readonly meta?: ReactNode;
  readonly id?: string;
}) {
  return (
    // Almost no margin of its own: the page body is a `gap-4` column (see
    // `PageBody`), so the space below the header belongs to the container like
    // every other gap on the screen. Rule 4.
    <div className="mb-1">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && (
                  // A slash rather than a chevron: a chevron points a
                  // direction, and on an Arabic page it would point the wrong
                  // one. This character is direction-neutral.
                  <span aria-hidden="true" className="opacity-50">
                    /
                  </span>
                )}
                {c.href ? (
                  <a href={c.href} className={s.link}>
                    {c.label}
                  </a>
                ) : (
                  <span aria-current="page" className="text-foreground">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 id={id} className={s.pageTitle}>
              {title}
            </h1>
            {meta}
          </div>
          {description && (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className={cn(s.toolbar, "shrink-0")}>{actions}</div>}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * PageBody
 * -------------------------------------------------------------------------- */

/**
 * The column every screen's contents sit in — UI.25.
 *
 * `flex flex-col gap-4`, not `space-y-4`, and the difference is the whole
 * reason it exists. `space-y` sets `margin-top` through a compound selector
 * that OUTRANKS a plain `mt-8` on the child, so adopting it would silently
 * flatten every deliberate section break on the finance, inventory and AI
 * screens. A flex gap ADDS to a child's own margin instead of replacing it, so
 * the default rhythm is one value and a screen that genuinely wants a bigger
 * break can still say so.
 *
 * This is rule 4 applied at the top: six components on the order screen were
 * each applying their own top margin from inside their own file, so the gap
 * between two panels was decided by whichever rendered second and reordering
 * them changed the layout.
 */
export function PageBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

/* -----------------------------------------------------------------------------
 * Section / Card
 * -------------------------------------------------------------------------- */

/**
 * A titled region on a screen.
 *
 * The heading is `aria-labelledby`-bound to the section rather than merely
 * placed inside it, so a screen reader can list the regions of a 653-line order
 * detail and jump between them — which was the one thing that screen offered no
 * way to do at all.
 *
 * `flush` exists for a section whose body is a table: the table brings its own
 * border and padding, and nesting it inside a padded card produces the double
 * frame that made the finance screen look like two products.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
  headingId,
  testId,
  ...rest
}: {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly flush?: boolean;
  readonly headingId?: string;
  readonly testId?: string;
} & Record<`data-${string}`, string | undefined>) {
  const id = headingId ?? (typeof title === "string" ? `sec-${slug(title)}` : undefined);

  return (
    <section
      className={cn(s.surface, className)}
      aria-labelledby={title ? id : undefined}
      data-testid={testId}
      {...rest}
    >
      {(title || actions) && (
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5",
            !children && "pb-4 sm:pb-5",
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 id={id} className={s.sectionTitle}>
                {title}
              </h2>
            )}
            {description && <p className={cn(s.hint, "mt-1 max-w-prose")}>{description}</p>}
          </div>
          {actions && <div className={cn(s.toolbar, "shrink-0")}>{actions}</div>}
        </div>
      )}
      <div
        className={cn(
          // Explicit rather than `p-4 … pt-3` and trusting the merge: an
          // unprefixed `pt-3` does not override an `sm:p-5`, so the padding
          // would silently differ across the breakpoint.
          flush
            ? title
              ? "mt-4"
              : ""
            : title
              ? "px-4 pb-4 pt-3 sm:px-5 sm:pb-5"
              : "p-4 sm:p-5",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** A stable, ASCII-safe id from a heading. Arabic and French headings collapse
 *  to a hash of their code points rather than to an empty string, which would
 *  make every section on an Arabic page share one id. */
function slug(text: string): string {
  const ascii = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (ascii) return ascii;
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return `h${h.toString(36)}`;
}

/* -----------------------------------------------------------------------------
 * Stat tiles
 * -------------------------------------------------------------------------- */

/**
 * One figure and its label.
 *
 * `dir="ltr"` and `tabular-nums` on the value are not decoration: a number is
 * read left-to-right on an Arabic page too, and a column of figures that shifts
 * as the digits change is a column nobody can compare down.
 */
export function Stat({
  label,
  value,
  sub,
  tone,
  href,
  testId,
  id,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly sub?: ReactNode;
  /** Inline tone vars from `toneVars()`, for a figure that is itself a state. */
  readonly tone?: Record<string, string>;
  readonly href?: string;
  readonly testId?: string;
  readonly id?: string;
}) {
  const body = (
    <>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className="mt-1.5 block text-2xl/none font-semibold tabular-nums tracking-tight"
        dir="ltr"
      >
        {value}
      </span>
      {/* `data-sub` carries the tile's id: the analytics suite asserts that the
          confirmation rate is rendered UNDER the confirmed count rather than as
          a tile of its own, and that assertion is what stops it drifting back
          into being a seventh figure nobody relates to anything. */}
      {sub && (
        <span data-sub={id} className={cn(s.meta, "mt-1.5 block")}>
          {sub}
        </span>
      )}
    </>
  );

  const shell = cn(
    s.surface,
    "p-4 transition-colors duration-(--duration-fast)",
    href && "hover:bg-surface-hover hover:border-muted-foreground/30",
  );

  return href ? (
    <a href={href} className={shell} data-tile={id} data-testid={testId} style={tone}>
      {body}
    </a>
  ) : (
    <div className={shell} data-tile={id} data-testid={testId} style={tone}>
      {body}
    </div>
  );
}

/**
 * The row a screen's headline figures live in.
 *
 * `auto-fit` rather than a fixed column count: five tiles on a laptop become
 * three and two rather than three and "two stretched to fill", and a tenant
 * whose role hides the customer count (D-05.1) does not leave a hole.
 */
export function StatGrid({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]"
    >
      {children}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Empty state
 * -------------------------------------------------------------------------- */

/**
 * What a list says when it has nothing.
 *
 * The `filtered` distinction is the point. "No orders yet" on
 * `?status=cancelled` in a tenant with 4,000 orders is simply false, and it
 * sends the reader to the wrong next action — they go looking for the create
 * button when what they need is to clear a filter. Two situations, two
 * sentences, and the caller supplies both because only the caller knows which
 * one it is in.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  testId,
  compact = false,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly testId?: string;
  readonly compact?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      data-empty="true"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-center",
        compact ? "gap-2 p-6" : "gap-3 p-10",
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-subtle text-muted-foreground"
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Field
 * -------------------------------------------------------------------------- */

/**
 * A label, a control, its help and its error — bound together.
 *
 * THE DEFECT THIS CLOSES. `ActionError` renders one `role="alert"` at panel
 * level and nothing else. On the new-order panel that is eleven fields sharing
 * one message: the operator is told THAT something was refused and never WHICH,
 * and a screen-reader user gets the sentence with no context at all.
 *
 * So the error is bound with `aria-describedby` and the control is marked
 * `aria-invalid`, which is also what lights the input's own tinted border
 * (`styles.control`). The panel-level `ActionError` stays — a refusal like
 * `FORBIDDEN_FIELD` belongs to the request, not to a field.
 *
 * `required` renders a mark AND `aria-required` on the control, because an
 * asterisk is invisible to a screen reader and an attribute is invisible to
 * everyone else.
 */
export function Field({
  id,
  label,
  help,
  error,
  required = false,
  children,
  className,
  hideLabel = false,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  /** Receives the ids it must reference — see `fieldAria`. */
  readonly children: ReactNode;
  readonly className?: string;
  readonly hideLabel?: boolean;
}) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className={cn(s.fieldLabel, hideLabel && "sr-only", "block")}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ms-0.5 text-(--danger-fg)">
              *
            </span>
          </>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
      {help && !error && (
        <p id={helpId} className={cn(s.hint, "mt-1.5")}>
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-(--danger-fg)">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The attributes a control inside a `<Field>` must carry.
 *
 * Returned as an object rather than injected by cloning children: the control
 * may be an `<input>`, a `<select>`, a `<textarea>` or a composite, and
 * `cloneElement` onto "whatever was passed" is how a prop ends up on a `<div>`.
 */
export function fieldAria(
  id: string,
  opts: { readonly required?: boolean; readonly help?: boolean; readonly error?: boolean } = {},
) {
  const described = [opts.help && !opts.error ? `${id}-help` : null, opts.error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    ...(opts.required ? { required: true, "aria-required": true as const } : {}),
    ...(opts.error ? { "aria-invalid": true as const } : {}),
    ...(described ? { "aria-describedby": described } : {}),
  };
}

/* -----------------------------------------------------------------------------
 * Definition list
 * -------------------------------------------------------------------------- */

/**
 * Label/value pairs — a customer card, an order summary, a product's figures.
 *
 * Every screen that shows one of these built it from `<p>` tags with a muted
 * `<span>` prefix, which is not a list to anything reading the page
 * structurally. This is a real `<dl>`, and it lines the values up.
 */
export function DescriptionList({
  items,
  columns = 1,
  className,
}: {
  readonly items: readonly {
    readonly label: ReactNode;
    readonly value: ReactNode;
    readonly ltr?: boolean;
    readonly testId?: string;
  }[];
  readonly columns?: 1 | 2 | 3;
  readonly className?: string;
}) {
  const cols =
    columns === 3
      ? "sm:grid-cols-3"
      : columns === 2
        ? "sm:grid-cols-2"
        : "";
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols, className)}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0" data-testid={item.testId}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className={cn("mt-0.5 text-sm text-foreground", item.ltr && "tabular-nums")}
            {...(item.ltr ? { dir: "ltr" as const } : {})}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -----------------------------------------------------------------------------
 * Notice
 * -------------------------------------------------------------------------- */

/**
 * A banner: something true about this screen that the reader must act on or
 * account for.
 *
 * `role` is a prop and defaults to `status` rather than `alert`. An `alert`
 * interrupts a screen reader mid-sentence; a rendered banner that was already
 * there when the page loaded has not interrupted anything, and marking it
 * `alert` is how a console becomes one that gets muted.
 */
export function Notice({
  tone,
  children,
  icon,
  role = "status",
  testId,
  className,
  ...rest
}: {
  /** Inline tone vars from `toneVars()`. */
  readonly tone?: Record<string, string>;
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly role?: "status" | "alert" | "note";
  readonly testId?: string;
  readonly className?: string;
} & Record<`data-${string}`, string | number | undefined>) {
  return (
    <div
      role={role === "note" ? undefined : role}
      data-testid={testId}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm",
        !tone && "border-border bg-surface-subtle",
        className,
      )}
      style={tone}
      {...rest}
    >
      {icon && (
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Skeleton
 * -------------------------------------------------------------------------- */

/**
 * The shape of content that has not arrived.
 *
 * Every console page is `force-dynamic` and opens a tenant-bound transaction,
 * so every navigation had a dead interval with nothing on screen. These are
 * what the new `loading.tsx` files render — deliberately the SHAPE of the
 * screen rather than a spinner, because a spinner says "wait" and a shape says
 * "this is where the table will be", which is the difference between a console
 * that feels slow and one that feels answered.
 */
export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-subtle", className)}
    />
  );
}

/** A table's worth of them. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className={cn(s.surface, "overflow-hidden")}>
      <div className={cn(s.surfaceHeader, "flex gap-4 border-b border-border px-3 py-2.5")}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-border px-3 py-3.5 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3.5 flex-1", c === 0 && "max-w-28")} />
          ))}
        </div>
      ))}
    </div>
  );
}
