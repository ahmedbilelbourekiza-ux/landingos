"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import { Field, fieldAria } from "@/components/console/ui/primitives";

/* =============================================================================
 * Taking an order over the phone — LP.4.
 *
 * `POST /api/erp/orders` has been contract-tested since Phase 5.2. It
 * normalises the number, creates the customer record, runs auto-assignment and
 * raises a notification — and until now NOTHING CALLED IT from the console. A
 * manager with a customer on the line had no way to enter the order. The legacy
 * CRM opens this modal from its main screen, and the second-pass review found
 * the gap only because it stopped counting routes and started counting
 * workflows.
 *
 * THE FIELD LIST IS THE ROUTE'S, not a fresh one. Every box below names a key
 * `CreateOrder` parses; none names a key it ignores. A form with its own idea of
 * the fields is the second vocabulary LP.3 spent a slice removing — it goes
 * stale silently, and the way it shows up is a box somebody fills in that
 * quietly does nothing.
 *
 * TWO FIELDS THE ROUTE ACCEPTS AND THIS DOES NOT OFFER, both stated rather than
 * silently missing:
 *
 *   `deliveryMethod` — 'COD' everywhere, with no vocabulary anywhere to build
 *   options from. A free-text box would write values nothing downstream
 *   understands. This is the rule NEXT_STEPS §1 already records.
 *
 *   `source` — set by the system to "manual" and refused from a caller, because
 *   an order claiming to have arrived from Shopify when it did not corrupts
 *   every channel report downstream.
 * ========================================================================== */

const FIELD = "ui-control tap";

export interface OrderCreateStrings {
  readonly saving: string;
  readonly cancel: string;
  readonly newOrder: string;
  readonly createOrder: string;
  readonly hint: string;
  readonly customer: string;
  readonly phone: string;
  readonly wilaya: string;
  readonly commune: string;
  readonly city: string;
  readonly product: string;
  readonly variant: string;
  readonly quantity: string;
  readonly price: string;
  readonly status: string;
  readonly agent: string;
  readonly unassigned: string;
  readonly carrier: string;
  readonly defaultCarrier: string;
  readonly note: string;
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

const EMPTY = {
  client: "", phone: "", wilaya: "", commune: "", city: "",
  product: "", productVariant: "", quantity: "1", price: "",
  status: "", agentUserId: "", carrierCode: "", note: "",
};

export function OrderCreatePanel({
  errors,
  s,
  statuses,
  members,
  carriers,
}: {
  readonly errors: ActionErrors;
  readonly s: OrderCreateStrings;
  readonly statuses: readonly Choice[];
  /** Absent for anybody who cannot assign — see below. */
  readonly members?: readonly Choice[];
  readonly carriers: readonly Choice[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /* The route's own rule, mirrored: an order with neither a name nor a number
     is refused, because an order nobody can be called about cannot be confirmed
     and would sit in the queue forever being counted as work. The button is
     disabled rather than the refusal being a surprise — and the API still
     refuses, which is what the contract test drives. */
  const usable = form.client.trim() !== "" || form.phone.trim() !== "";

  /* UI.23 — THE PANEL SAYS WHAT IT NEEDS BEFORE IT REFUSES.
   *
   * Eleven fields shared one `role="alert"` at the bottom, so an operator was
   * told THAT something was refused and never WHICH — and a screen-reader user
   * got the sentence with no context at all. `<Field>` binds the message to the
   * control with `aria-describedby` and marks it `aria-invalid`, which is also
   * what tints the input's border.
   *
   * `required` here mirrors the ROUTE'S own rule and nothing more: an order
   * with neither a name nor a number cannot be called about, so it is refused.
   * The mark is rendered AND `aria-required` is set, because an asterisk is
   * invisible to a screen reader and an attribute is invisible to everybody
   * else. The API still refuses either way — this only stops the refusal being
   * the first time anybody hears about it. */
  const text = (
    id: keyof typeof form,
    label: string,
    extra?: { ltr?: boolean; required?: boolean; help?: string },
  ) => {
    const fid = `new-order-${id}`;
    return (
      <Field id={fid} label={label} required={extra?.required} help={extra?.help}>
        <input
          {...fieldAria(fid, { required: extra?.required, help: Boolean(extra?.help) })}
          name={id}
          value={form[id]}
          onChange={(e) => set(id, e.target.value)}
          {...(extra?.ltr ? { dir: "ltr" as const } : {})}
          className={`${FIELD} w-full`}
        />
      </Field>
    );
  };

  const choose = (
    id: keyof typeof form,
    label: string,
    options: readonly Choice[],
    anyLabel: string,
    help?: string,
  ) => {
    const fid = `new-order-${id}`;
    return (
      <Field id={fid} label={label} help={help}>
        <select
          {...fieldAria(fid, { help: Boolean(help) })}
          name={id}
          value={form[id]}
          onChange={(e) => set(id, e.target.value)}
          className={`${FIELD} w-full`}
        >
          <option value="">{anyLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
    );
  };

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-order-create">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{s.newOrder}</h2>
        <ActionButton
          data-testid="order-create-toggle"
          aria-expanded={open}
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? s.cancel : s.newOrder}
        </ActionButton>
      </div>

      {/* D-06.4: rendered always, hidden when closed. Mounting on click means
          the offered vocabulary only exists after JavaScript runs — unassertable
          by a contract test and unreadable to assistive tech until somebody
          clicks. */}
      <div hidden={!open}>
        <p className="mt-2 text-xs text-muted-foreground">{s.hint}</p>

        {/* Grouped into the three questions an operator is actually answering —
            who, what, and how it is handled — rather than eleven boxes in one
            run. Nothing moved between groups that changes what is sent. */}
        <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {text("client", s.customer, { required: true })}
          {/* A phone number is always left-to-right, even on an RTL page, or the
              digits appear reordered. The route normalises whatever is typed —
              +213 555 12 34 56 is stored as 0555123456 — so there is nothing to
              validate here that the server does not do better. */}
          {text("phone", s.phone, { ltr: true, required: true })}
          {text("wilaya", s.wilaya)}
          {text("commune", s.commune)}
          {text("city", s.city)}
          {text("product", s.product)}
          {text("productVariant", s.variant)}

          <Field id="new-order-quantity" label={s.quantity}>
            <input
              {...fieldAria("new-order-quantity")}
              name="quantity" type="number" min={1} dir="ltr"
              value={form.quantity} onChange={(e) => set("quantity", e.target.value)}
              className={`${FIELD} w-full`}
            />
          </Field>

          <Field id="new-order-price" label={s.price}>
            {/* Text with a decimal keypad, never type="number" — a number input
                hands back a JS float and `price` is a Decimal column (M-06). */}
            <input
              {...fieldAria("new-order-price")}
              name="price" inputMode="decimal" dir="ltr"
              value={form.price} onChange={(e) => set("price", e.target.value)}
              className={`${FIELD} w-full`}
            />
          </Field>

          {choose("status", s.status, statuses, statuses[0]?.label ?? "")}
          {/* The tenant's own carriers, not a free-text code. `createShipment`
              looks the code up and falls back to the default when it matches
              nothing, so a typed code would book the wrong carrier and say
              nothing. Empty means "use the default", which is what the ERP
              did — and the field now SAYS so, where it used to be a rule that
              lived only in this comment. */}
          {choose("carrierCode", s.carrier, carriers, s.defaultCarrier, s.defaultCarrier)}

          {/* D-06.2. The route answers 403 FORBIDDEN_FIELD for `agentUserId`
              from anybody who does not see the whole book, so the control only
              exists for somebody it would accept it from. Absent, not
              disabled: a disabled select still says "you nearly could". */}
          {members && choose("agentUserId", s.agent, members, s.unassigned)}

          <Field id="new-order-note" label={s.note} className="sm:col-span-2 lg:col-span-4">
            <textarea
              {...fieldAria("new-order-note")}
              name="note" rows={2}
              value={form.note} onChange={(e) => set("note", e.target.value)}
              className={`${FIELD} w-full`}
            />
          </Field>
        </div>

        <div className="mt-4">
          <ActionButton
            data-testid="order-create-submit"
            pending={pending}
            pendingLabel={s.saving}
            variant="primary"
            disabled={!usable}
            onClick={async () => {
              // Only what was filled in. Sending "" for every untouched box
              // would store empty strings where the route's own defaults are
              // better, and would make `quantity: ""` a validation error for a
              // field nobody touched.
              const body: Record<string, string> = {};
              for (const [k, v] of Object.entries(form)) {
                if (v.trim() !== "") body[k] = v.trim();
              }
              const { ok } = await run("POST", "/api/erp/orders", body);
              // D-06.3: no optimistic row. `run` refreshes on success and the
              // server component re-renders from the database, so the new order
              // appears because it is THERE — not because this form assumed it.
              if (ok) {
                setForm({ ...EMPTY });
                setOpen(false);
              }
            }}
          >
            {s.createOrder}
          </ActionButton>
        </div>

        <ActionError message={error} />
      </div>
    </section>
  );
}
