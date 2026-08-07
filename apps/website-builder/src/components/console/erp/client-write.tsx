"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import { flashEntity } from "@/components/console/row-flash";
import type { ActionErrors } from "@/lib/console/action-errors";

/* =============================================================================
 * Correcting a customer record — LP.10, restoring R5.
 *
 * FOUR FIELDS, AND THE LIST IS THE POINT. `name`, `wilaya`, `commune` and
 * `address` are the ones with no reliable automatic source: an address is never
 * captured by an order at all, and a name or a wilaya arrives misspelled from a
 * storefront and must be fixable without waiting for the customer to order
 * again.
 *
 * WHAT IS NOT HERE IS THE DESIGN. Every lifetime counter — orders, confirmed,
 * cancelled, delivered, spend — and every `imported*` column is absent, because
 * they move only through order events. `PATCH /api/erp/clients/[id]` refuses
 * them BY NAME rather than dropping them (D-LP.1), so this component and the
 * route agree without the component knowing the rule.
 *
 * D-06.1: it calls the route. D-06.3: on success the router refreshes and the
 * server re-renders; nothing here decides what the record now says.
 * ========================================================================== */

export interface ClientEditStrings {
  readonly saving: string;
  readonly panel: string;
  readonly name: string;
  readonly wilaya: string;
  readonly commune: string;
  readonly address: string;
  readonly save: string;
  readonly hint: string;
}

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function ClientEditPanel({
  clientId,
  errors,
  s,
  initial,
}: {
  readonly clientId: string;
  readonly errors: ActionErrors;
  readonly s: ClientEditStrings;
  readonly initial: {
    name: string;
    wilaya: string;
    commune: string;
    address: string;
  };
}) {
  const { run, pending, error } = useApiAction(errors);
  const [draft, setDraft] = useState(initial);

  const set = (k: keyof typeof initial, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    const { ok } = await run("PATCH", `/api/erp/clients/${clientId}`, draft);
    if (ok) flashEntity(clientId);
  };

  const field = (k: keyof typeof initial, label: string) => (
    <div>
      <label htmlFor={`client-${k}`} className="ui-label block">
        {label}
      </label>
      <input
        id={`client-${k}`}
        value={draft[k]}
        onChange={(e) => set(k, e.target.value)}
        className={`mt-1 ${FIELD}`}
      />
    </div>
  );

  return (
    <section
      data-testid="client-edit"
      className="mt-6 rounded-lg border border-border p-4"
    >
      <h2 className="text-sm font-medium">{s.panel}</h2>
      {/* Said on the page rather than left to be discovered as a 422. The
          counters beside this panel look editable and are not. */}
      <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field("name", s.name)}
        {field("wilaya", s.wilaya)}
        {field("commune", s.commune)}
        {field("address", s.address)}
      </div>

      <ActionButton
        data-testid="client-save"
        className="mt-3 rounded-md border border-input px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        pending={pending}
        pendingLabel={s.saving}
        onClick={() => void save()}
      >
        {s.save}
      </ActionButton>

      <ActionError message={error} />
    </section>
  );
}
