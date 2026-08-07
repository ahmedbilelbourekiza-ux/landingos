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
  readonly webhookSecret: string;
  readonly webhookUrl: string;
  readonly webhookHint: string;
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
  readonly test: string;
  readonly sync: string;
  readonly logs: string;
  readonly noLogs: string;
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
    apiUrl: "", apiKey: "", secretKey: "", webhookSecret: "",
  };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const input = (k: keyof typeof f, label: string, secret = false) => (
    <div>
      <label htmlFor={`carrier-${k}`} className="ui-label block">
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
    <section className="mt-6 rounded-lg border border-border bg-surface-raised p-4" data-testid="erp-carrier-create">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{s.newCarrier}</h2>
        <ActionButton
          data-testid="carrier-create-toggle"
          aria-expanded={open}
          pending={false}
          pendingLabel={s.saving}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? s.cancel : s.newCarrier}
        </ActionButton>
      </div>

      {/* HIDDEN, never unmounted — D-06.4, and LP.5 is where it started to
          matter. `{open && …}` meant the offered adapter list only existed after
          somebody clicked, so no contract test could assert what this form lets
          a manager choose and assistive tech could not read it either. That is
          the rule NEXT_STEPS §1 already states; this panel was the one write
          surface still breaking it, and registering a second adapter is exactly
          when "which integrations can be chosen" became worth asserting. */}
      <div hidden={!open}>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {input("name", s.name)}
            {input("code", s.code)}
            <div>
              <label htmlFor="carrier-adapter" className="ui-label block">
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
            {/* The route has accepted `webhookSecret` since Phase 5 and no
                control ever sent one, so a carrier's inbound updates could only
                ever be UNSIGNED. That is the dominant defect class in this port
                — a tested endpoint with no caller — and it is load-bearing
                here: ZR Express signs every webhook with Svix, and a secret
                nobody can set is a signature nobody can check. */}
            {input("webhookSecret", s.webhookSecret, true)}
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
                  ...(f.webhookSecret ? { webhookSecret: f.webhookSecret } : {}),
                });
                if (ok) { setF(blank); setOpen(false); }
              }}
            >
              {s.create}
            </ActionButton>
          </div>

          <ActionError message={error} />
      </div>
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

export interface IntegrationLogRow {
  readonly id: string;
  readonly event: string;
  readonly result: string | null;
  readonly message: string | null;
  readonly ts: string;
}

export function CarrierRowActions({
  carrierId,
  isDefault,
  active,
  hasCredentials,
  canPoll,
  webhookUrl,
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
  /** Whether this carrier's adapter can be ASKED where a parcel is (LP.14). */
  readonly canPoll: boolean;
  /** Where this tenant's carriers push delivery updates. Not a secret. */
  readonly webhookUrl: string;
  readonly mappings: readonly StatusMapping[];
  readonly crmStatuses: readonly WriteOption[];
  readonly errors: ActionErrors;
  readonly s: CarrierStrings;
}) {
  const { run, pending, error } = useApiAction(errors);
  const [panel, setPanel] = useState<"none" | "keys" | "mappings" | "logs">("none");

  // The mask where a key exists, empty where none does — which is the
  // distinction `_hasCredentials` was added to the API to make, because an
  // empty field and a hidden one look identical otherwise.
  const stored = hasCredentials ? CARRIER_SECRET_MASK : "";
  const [apiKey, setApiKey] = useState(stored);
  const [secretKey, setSecretKey] = useState(stored);
  const [webhookSecret, setWebhookSecret] = useState(stored);

  const [originalStatus, setOriginalStatus] = useState("");
  const [crmStatus, setCrmStatus] = useState(crmStatuses[0]?.value ?? "");

  /** Only a value the user actually typed. The mask and a blank are both "leave it". */
  const changed = (value: string) =>
    value && value !== CARRIER_SECRET_MASK ? value : undefined;

  const [logs, setLogs] = useState<IntegrationLogRow[] | null>(null);

  const toggle = (next: "keys" | "mappings" | "logs") => {
    setPanel((p) => (p === next ? "none" : next));
    // Fetched on OPEN rather than rendered with the page: an integration log is
    // diagnostic, it is read rarely, and loading one per carrier row would put
    // N queries behind every visit to this screen.
    if (next === "logs" && panel !== "logs" && logs === null) void loadLogs();
  };

  const loadLogs = async () => {
    const res = await fetch(`/api/erp/carriers/${carrierId}/logs?limit=50`, {
      credentials: "same-origin",
    });
    const envelope = await res.json().catch(() => null);
    setLogs(res.ok && envelope?.success ? (envelope.data.items as IntegrationLogRow[]) : []);
  };

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

        {/* LP.14. `lastTestAt`/`lastTestOk`/`lastSyncAt` were rendered by this
            screen and written by NOTHING, so every carrier read "never tested"
            forever. An operator configuring ZR Express had no way to find out
            whether the key worked except by confirming a real order and
            watching for a parcel. */}
        <ActionButton
          data-testid="carrier-test"
          data-carrier-id={carrierId}
          pending={pending}
          pendingLabel={s.saving}
          onClick={() => void run("POST", `/api/erp/carriers/${carrierId}/test`, {})}
        >
          {s.test}
        </ActionButton>

        {/* Offered only where the adapter can actually be ASKED. ZR publishes
            no tracking endpoint at all — every update arrives on its webhook —
            and the route refuses by name, so the control that would trip it is
            not rendered (D-06.2). */}
        {canPoll && (
          <ActionButton
            data-testid="carrier-sync"
            data-carrier-id={carrierId}
            pending={pending}
            pendingLabel={s.saving}
            onClick={() => void run("POST", `/api/erp/carriers/${carrierId}/sync`, {})}
          >
            {s.sync}
          </ActionButton>
        )}

        <ActionButton
          data-testid="carrier-logs-toggle"
          pending={false}
          pendingLabel={s.saving}
          onClick={() => toggle("logs")}
          aria-expanded={panel === "logs"}
        >
          {s.logs}
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
          <input
            aria-label={s.webhookSecret} type="password" autoComplete="new-password"
            value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={s.webhookSecret} className={FIELD}
          />

          {/* Where the carrier pushes TO. Not a credential — it is derived from
              the tenant slug, which is in every storefront URL already — and
              without it there is no way to tell a carrier where to send
              anything, which makes the secret beside it pointless. */}
          <p className="text-xs text-muted-foreground">{s.webhookHint}</p>
          <input
            aria-label={s.webhookUrl}
            data-testid="carrier-webhook-url"
            readOnly
            dir="ltr"
            value={webhookUrl}
            onFocus={(e) => e.currentTarget.select()}
            className={`${FIELD} font-mono text-xs`}
          />

          <ActionButton
            data-testid="carrier-keys-save"
            pending={pending}
            pendingLabel={s.saving}
            variant="primary"
            disabled={!changed(apiKey) && !changed(secretKey) && !changed(webhookSecret)}
            onClick={async () => {
              const { ok } = await run("PUT", `/api/erp/carriers/${carrierId}`, {
                ...(changed(apiKey) ? { apiKey } : {}),
                ...(changed(secretKey) ? { secretKey } : {}),
                ...(changed(webhookSecret) ? { webhookSecret } : {}),
              });
              if (ok) {
                // Back to the mask: something is stored now either way, and
                // leaving the typed value on screen would be the one place this
                // console ever displayed a real key.
                setApiKey(CARRIER_SECRET_MASK);
                setSecretKey(CARRIER_SECRET_MASK);
                setWebhookSecret(CARRIER_SECRET_MASK);
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
                  {/* LP.14, R20's second half. A WRONG mapping was permanent —
                      `POST` upserts, so it could be corrected, but one that
                      should never have existed went on translating a carrier's
                      wording on every event that arrived. History is untouched:
                      `ShipmentEvent` keeps the original wording on every row. */}
                  <button
                    type="button"
                    data-testid="carrier-mapping-remove"
                    data-mapping-original={m.originalStatus}
                    className="ms-auto rounded border border-input px-1.5"
                    onClick={() =>
                      void run("DELETE", `/api/erp/carriers/${carrierId}/status-mappings`, {
                        originalStatus: m.originalStatus,
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label htmlFor={`map-original-${carrierId}`} className="ui-label block">
            {s.carrierSays}
          </label>
          <input
            id={`map-original-${carrierId}`} dir="ltr"
            value={originalStatus} onChange={(e) => setOriginalStatus(e.target.value)}
            className={FIELD}
          />

          <label htmlFor={`map-crm-${carrierId}`} className="ui-label block">
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

      {/* The integration log. `IntegrationLog` was migrated in Phase 3.2 with
          its indexes and had NO READER AND NO WRITER — so the only evidence of
          a failing integration was a parcel that did not book, and the only
          diagnosis available was "try again". Hidden rather than unmounted, like
          the panels above. No credential ever reaches the table; see `redact`. */}
      <div
        hidden={panel !== "logs"}
        className="w-full max-w-md space-y-2 rounded-md border border-border p-3 text-start"
        data-testid="carrier-logs-panel"
      >
        {logs === null ? (
          <p className="text-xs text-muted-foreground">{s.saving}</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="carrier-logs-empty">
            {s.noLogs}
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {logs.map((row) => (
              <li key={row.id} data-log-event={row.event} className="flex flex-col">
                <span className="font-mono text-muted-foreground" dir="ltr">
                  {row.ts} · {row.event} · {row.result}
                </span>
                {row.message && <span>{row.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ActionError message={error} />
    </div>
  );
}
