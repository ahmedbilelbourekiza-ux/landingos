"use client";

import { useState } from "react";

import { useApiAction, ActionError, ActionButton } from "@/components/console/api-action";
import type { ActionErrors } from "@/lib/console/action-errors";
import type { WriteOption } from "@/components/console/edit-field";
import { CARRIER_SECRET_MASK } from "@/lib/erp/carrier-mask";

/* =============================================================================
 * Delivery companies — Phase 6.3d.
 *
 * THE KEYS ARE STILL NEVER SELECTED. The carriers screen has never loaded a
 * credential and this file does not change that: it renders the MASK where one
 * exists, which is four bullet characters and not a secret, and it never
 * receives the real value at all.
 *
 * Two independent things then stop a form from destroying a stored key:
 *
 *   1. This component never SENDS the mask. A field left untouched, or cleared,
 *      is omitted from the request entirely.
 *   2. `preserveSecrets` on the server drops any secret field whose value came
 *      back as the mask.
 *
 * Either alone would do. Both, because the failure mode is silent and expensive:
 * nothing errors until the next shipment fails to book, by which time the key is
 * gone and nobody knows when.
 *
 * The one thing NOT offered is a way to clear a credential to empty. `PUT`
 * accepts `null` for that, but a blank text box is indistinguishable from "I did
 * not touch this", and guessing wrong wipes a key. Deactivating the carrier is
 * the control that exists for "stop using this".
 * ========================================================================== */

const FIELD = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface CarrierStrings {
  readonly saving: string;
  readonly cancel: string;
  readonly newCarrier: string;
  readonly name: string;
  readonly code: string;
  readonly adapter: string;
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly secretKey: string;
  readonly create: string;
  readonly save: string;
  readonly makeDefault: string;
  readonly deactivate: string;
  readonly activate: string;
  readonly credentials: string;
  readonly maskKeeps: string;
  readonly mappings: string;
  readonly carrierSays: string;
  readonly meansStatus: string;
  readonly addMapping: string;
  readonly noMappings: string;
}

/* -----------------------------------------------------------------------------
 * A new carrier
 * -------------------------------------------------------------------------- */

export function CarrierCreatePanel({
  errors,
  s,
  adapters,
}: {
  readonly errors: ActionErrors;
  readonly s: CarrierStrings;
  readonly adapters: readonly WriteOption[];
}) {
  const { run, pending, error } = useApiAction(errors);
  const [open, setOpen] = useState(false);
  const blank = {
    name: "", code: "", adapter: adapters[0]?.value ?? "mock",
    apiUrl: "", apiKey: "", secretKey: "",
  };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const input = (k: keyof typeof f, label: string, secret = false) => (
    <div>
      <label htmlFor={`carrier-${k}`} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <input
        id={`carrier-${k}`}
        // A password field so a key is not read over somebody's shoulder while
        // it is pasted. It is never read BACK — nothing selects credentials.
        type={secret ? "password" : "text"}
        autoComplete={secret ? "new-password" : "off"}
        dir={k === "code" || k === "apiUrl" ? "ltr" : undefined}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        className={`mt-1 ${FIELD}`}
      />
    </div>
  );

  return (
    <section className="mt-6 rounded-lg border border-border p-4" data-testid="erp-carrier-create">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{s.newCarrier}</h2>
        <ActionButton
          data-testid="carrier-create-toggle"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? s.cancel : s.newCarrier}
        </ActionButton>
      </div>

      {open && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {input("name", s.name)}
            {input("code", s.code)}
            <div>
              <label htmlFor="carrier-adapter" className="block text-xs text-muted-foreground">
                {s.adapter}
              </label>
              {/* From the live adapter registry, so a carrier implementation
                  added later appears here without a code change. */}
              <select
                id="carrier-adapter"
                value={f.adapter}
                onChange={(e) => set("adapter", e.target.value)}
                className={`mt-1 ${FIELD}`}
              >
                {adapters.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            {input("apiUrl", s.apiUrl)}
            {input("apiKey", s.apiKey, true)}
            {input("secretKey", s.secretKey, true)}
          </div>

          <div className="mt-4">
            <ActionButton
              data-testid="carrier-create-submit"
              pending={pending}
              pendingLabel={s.saving}
              variant="primary"
              disabled={!f.name.trim() || !f.code.trim()}
              onClick={async () => {
                const { ok } = await run("POST", "/api/erp/carriers", {
                  name: f.name.trim(),
                  code: f.code.trim(),
                  adapter: f.adapter,
                  ...(f.apiUrl.trim() ? { apiUrl: f.apiUrl.trim() } : {}),
                  ...(f.apiKey ? { apiKey: f.apiKey } : {}),
                  ...(f.secretKey ? { secretKey: f.secretKey } : {}),
                });
                if (ok) { setF(blank); setOpen(false); }
              }}
            >
              {s.create}
            </ActionButton>
          </div>

          <ActionError message={error} />
        </>
      )}
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * One carrier's controls
 * -------------------------------------------------------------------------- */

export interface StatusMapping {
  readonly id: string;
  readonly originalStatus: string;
  readonly crmStatus: string;
}

export function CarrierRowActions({
  carrierId,
  isDefault,
  active,
  hasCredentials,
  mappings,
  crmStatuses,
  errors,
  s,
}: {
  readonly carrierId: string;
  readonly isDefault: boolean;
  readonly active: boolean;
  /** Whether any credential is stored. NOT the credential. */
  readonly hasCredentials: boolean;
  readonly mappings: readonly StatusMapping[];
  readonly crmStatuses: readonly WriteOption[];
  readonly errors: ActionErrors;
  readonly s: CarrierStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [panel, setPanel] = useState<"none" | "keys" | "mappings">("none");

  // The mask where a key exists, empty where none does — which is the
  // distinction `_hasCredentials` was added to the API to make, because an
  // empty field and a hidden one look identical otherwise.
  const stored = hasCredentials ? CARRIER_SECRET_MASK : "";
  const [apiKey, setApiKey] = useState(stored);
  const [secretKey, setSecretKey] = useState(stored);

  const [originalStatus, setOriginalStatus] = useState("");
  const [crmStatus, setCrmStatus] = useState(crmStatuses[0]?.value ?? "");

  /** Only a value the user actually typed. The mask and a blank are both "leave it". */
  const changed = (value: string) =>
    value && value !== CARRIER_SECRET_MASK ? value : undefined;

  const toggle = (next: "keys" | "mappings") =>
    setPanel((p) => (p === next ? "none" : next));

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {/* Already the default, or inactive: there is nothing the button could
            do, and POST /default reactivates rather than being a no-op. */}
        {!isDefault && (
          <ActionButton
            data-testid="carrier-make-default"
            data-carrier-id={carrierId}
            pending={pending}
            pendingLabel={s.saving}
            onClick={() => void run("POST", `/api/erp/carriers/${carrierId}/default`)}
          >
            {s.makeDefault}
          </ActionButton>
        )}

        {/* Deactivate, not delete: shipments reference their carrier and the
            relation is SetNull, so deleting would leave historical parcels with
            no way to say who carried them. */}
        <ActionButton
          data-testid={active ? "carrier-deactivate" : "carrier-activate"}
          data-carrier-id={carrierId}
          pending={pending}
          pendingLabel={s.saving}
          onClick={() =>
            void (active
              ? run("DELETE", `/api/erp/carriers/${carrierId}`)
              : run("PUT", `/api/erp/carriers/${carrierId}`, { active: true }))
          }
        >
          {active ? s.deactivate : s.activate}
        </ActionButton>

        <ActionButton
          data-testid="carrier-keys-toggle"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => toggle("keys")}
          aria-expanded={panel === "keys"}
        >
          {s.credentials}
        </ActionButton>

        <ActionButton
          data-testid="carrier-mappings-toggle"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => toggle("mappings")}
          aria-expanded={panel === "mappings"}
        >
          {s.mappings}
        </ActionButton>
      </div>

      {/* Both panels are HIDDEN rather than unmounted, so what they offer — and
          the CRM vocabulary in particular — is in the document whether or not
          anybody has opened them. See the note in agent-write.tsx. */}
      <div
        hidden={panel !== "keys"}
        className="w-full max-w-xs space-y-2 rounded-md border border-border p-3 text-start"
        data-testid="carrier-keys-panel"
      >
          <p className="text-xs text-muted-foreground">{s.maskKeeps}</p>
          <input
            aria-label={s.apiKey} type="password" autoComplete="new-password"
            value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={s.apiKey} className={FIELD}
          />
          <input
            aria-label={s.secretKey} type="password" autoComplete="new-password"
            value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
            placeholder={s.secretKey} className={FIELD}
          />
          <ActionButton
            data-testid="carrier-keys-save"
            pending={pending}
            pendingLabel={s.saving}
            variant="primary"
            disabled={!changed(apiKey) && !changed(secretKey)}
            onClick={async () => {
              const { ok } = await run("PUT", `/api/erp/carriers/${carrierId}`, {
                ...(changed(apiKey) ? { apiKey } : {}),
                ...(changed(secretKey) ? { secretKey } : {}),
              });
              if (ok) {
                // Back to the mask: something is stored now either way, and
                // leaving the typed value on screen would be the one place this
                // console ever displayed a real key.
                setApiKey(CARRIER_SECRET_MASK);
                setSecretKey(CARRIER_SECRET_MASK);
                setPanel("none");
              }
            }}
          >
            {s.save}
          </ActionButton>
      </div>

      <div
        hidden={panel !== "mappings"}
        className="w-full max-w-sm space-y-2 rounded-md border border-border p-3 text-start"
        data-testid="carrier-mappings-panel"
      >
          {/* Carriers do not standardise their wording — the same company writes
              "Livré", "Livré au client" and "LIVRE" across three API versions —
              so a tenant teaches the system their carrier's dialect here rather
              than waiting for a deploy. */}
          {mappings.length === 0 ? (
            <p className="text-xs text-muted-foreground">{s.noMappings}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {mappings.map((m) => (
                <li key={m.id} data-mapping={m.originalStatus} className="flex gap-2">
                  <span className="font-mono text-muted-foreground" dir="ltr">
                    {m.originalStatus}
                  </span>
                  <span aria-hidden>→</span>
                  <span>{crmStatuses.find((c) => c.value === m.crmStatus)?.label ?? m.crmStatus}</span>
                </li>
              ))}
            </ul>
          )}

          <label htmlFor={`map-original-${carrierId}`} className="block text-xs text-muted-foreground">
            {s.carrierSays}
          </label>
          <input
            id={`map-original-${carrierId}`} dir="ltr"
            value={originalStatus} onChange={(e) => setOriginalStatus(e.target.value)}
            className={FIELD}
          />

          <label htmlFor={`map-crm-${carrierId}`} className="block text-xs text-muted-foreground">
            {s.meansStatus}
          </label>
          {/* A select, not a text box. The CRM side has a fixed vocabulary — the
              delivery status registry — and a free-text value would map a
              carrier's wording onto a status nothing downstream understands. */}
          <select
            id={`map-crm-${carrierId}`}
            value={crmStatus} onChange={(e) => setCrmStatus(e.target.value)}
            className={FIELD}
          >
            {crmStatuses.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          <ActionButton
            data-testid="carrier-mapping-add"
            pending={pending}
            pendingLabel={s.saving}
            variant="primary"
            disabled={!originalStatus.trim()}
            onClick={async () => {
              const { ok } = await run(
                "POST",
                `/api/erp/carriers/${carrierId}/status-mappings`,
                { originalStatus: originalStatus.trim(), crmStatus },
              );
              if (ok) setOriginalStatus("");
            }}
          >
            {s.addMapping}
          </ActionButton>
      </div>

      <ActionError message={error} />
    </div>
  );
}
