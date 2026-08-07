import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { SettingsForm } from "@/components/console/erp/settings-form";
import {
  FixedCostsEditor,
  ChannelCarrierEditor,
} from "@/components/console/erp/settings-structured";
import { structuredStrings, readFixedCostRows, readChannelCarriers } from "@/lib/console/erp-strings";
import type { SettingField } from "@/components/console/setting-field";
import { readSettings, SETTINGS_SCHEMA } from "@/lib/erp/settings";
import { JobRunner } from "@/components/console/erp/job-runner";
// The route's own list, not a copy — D-LP.3. A job added there appears here.
import { JOBS } from "@/lib/erp/jobs";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The ERP's automation rules — Phase 6.3d, and the one screen 6.3 adds rather
 * than makes writable.
 *
 * IT IS NOT CALLED "SETTINGS", AND THE REGISTRY'S OWN TEST IS WHY. A tenant with
 * N products must still see ONE Settings, owned by the shell — profile, company,
 * delivery prices, integrations — and a product shipping its own is the first
 * step to N of them. The nav item was rejected at `id: 'settings'` and the name
 * turned out to be the whole problem: every key on this page is a rule the ERP
 * applies BY ITSELF — assign, confirm, reassign, suspend, reserve, poll — so
 * "automation" is what it actually is.
 *
 * The stored rows are still `ProductSetting` keyed by (tenant, product, key) —
 * which is why a tenth product stores its configuration without a new table and
 * no tenant can read another's — and the route is still `PUT /api/erp/settings`.
 *
 * THE FIELDS COME FROM THE SCHEMA THE ROUTE VALIDATES AGAINST. `SETTINGS_SCHEMA`
 * is exported from `lib/erp/settings.ts` for exactly this: a form with its own
 * list of fields is a second vocabulary, it goes stale the moment a setting is
 * added, and the way that shows up is a control nobody can find rather than an
 * error anybody sees.
 *
 * GATED HERE, not merely unlinked. The nav hides this item without
 * `erp:settings:write`, but a nav item is a hint and the URL is typeable — the
 * same reasoning that put a check in the clients, finance and agents pages.
 * ========================================================================== */

export default async function ErpAutomationScreen() {
  const { session, t } = await requireProduct("erp", "/console/erp/automation");

  // `erp:settings:write` is what PUT /api/erp/settings checks. Reading them is
  // `erp:read`, but a read-only view of a settings form is a page of disabled
  // boxes — the screen exists to change them.
  if (!session.auth || !can(session.auth, "erp:settings:write")) notFound();

  const { stored, channels, carriers } = await withTenant(session.auth.tenantId, async (db) => ({
    stored: await readSettings(db),
    // The vocabularies the structured editors offer, read from the same tables
    // the shipment path resolves against — so a channel that exists cannot be
    // missing from the map, and a carrier code that would book nothing cannot
    // be chosen.
    channels: await db.salesChannel.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // A carrier with no code cannot be resolved by `planShipment`, so offering
    // one would put a choice in the map that books nothing.
    carriers: await db.carrier.findMany({
      where: { active: true, code: { not: null } },
      orderBy: { name: "asc" },
      select: { code: true, name: true },
    }),
  }));

  /* Which settings get a control is decided by their TYPE, not by a list of
     names kept in step by hand. Two are structured — `defaultCarrierByChannel`
     is a map from sales channel to carrier, `fixedCosts` a list of
     `{ id, label, amount }` — and each needs an editor of its own. A JSON
     textarea would accept anything the server's `typeof value === "object"`
     check happens to allow, which is how a settings table becomes a scratchpad.
     LP.16b BUILT THOSE TWO EDITORS (below, and N23 is why): until then both
     settings were declared, validated, read by real code, and unreachable by
     any control — so every saved P&L was missing its rent.
     Filtering on the type rather than the name means a structured setting added
     later is still excluded automatically instead of silently rendering as a
     checkbox, and shows up here as a setting with no editor rather than as a
     wrong one. */
  const fields: SettingField[] = Object.entries(SETTINGS_SCHEMA)
    .filter(([, spec]) => spec.type !== "object" && spec.type !== "array")
    .map(([key, spec]) => {
      const value = stored[key];
      if (spec.type === "enum") {
        return {
          key,
          label: t(`erp.settings.${key}`),
          kind: "enum" as const,
          value: String(value ?? ""),
          // The route's own list, so an option that would be refused cannot be
          // offered and one it accepts cannot go missing.
          options: spec.values.map((v) => ({
            value: v,
            label: t(`erp.settings.reservation.${v}`),
          })),
        };
      }
      if (spec.type === "number") {
        return {
          key,
          label: t(`erp.settings.${key}`),
          kind: "number" as const,
          value: String(value ?? ""),
          // The bounds the route enforces, on the control. Not a substitute for
          // the server check — a number input is trivially bypassed — it just
          // means an honest mistake is caught where it is made.
          min: spec.min,
          max: spec.max,
        };
      }
      return {
        key,
        label: t(`erp.settings.${key}`),
        kind: "boolean" as const,
        value: String(Boolean(value)),
      };
    });

  const structured = structuredStrings(t);
  const fixedCosts = readFixedCostRows(stored.fixedCosts);
  const channelCarriers = readChannelCarriers(stored.defaultCarrierByChannel);

  return (
    <ConsoleShell session={session} productId="erp">
      <PageBody>
      <PageHeader title={t("erp.settings.title")} />

      <SettingsForm
        // Keyed on what is stored, so a save remounts the form on the server's
        // answer rather than on what was typed.
        key={fields.map((f) => `${f.key}=${f.value}`).join(" ")}
        errors={actionErrors(t)}
        fields={fields}
        saving={t("common.saving")}
        save={t("common.save")}
        atomicHint={t("erp.settings.atomicHint")}
      />

      {/* The two structured settings, LP.16b. Same route, same permission, own
          editors — see components/console/erp/settings-structured.tsx. Both are
          keyed on the stored value for the same reason the form above is. */}
      <FixedCostsEditor
        key={`fc:${JSON.stringify(fixedCosts)}`}
        errors={actionErrors(t)}
        s={structured}
        rows={fixedCosts}
      />

      <ChannelCarrierEditor
        key={`cc:${JSON.stringify(channelCarriers)}`}
        errors={actionErrors(t)}
        s={structured}
        channels={channels}
        carriers={carriers.map((c) => ({ code: c.code!, name: c.name }))}
        value={channelCarriers}
      />

      {/* AUDIT.6. `POST /api/erp/jobs/[job]` was reachable only by typing a URL,
          and its own comment says why it exists: "a manager needs to be able to
          say 'run it now' after changing a threshold". Here, because every job
          acts on a rule configured directly above it. D-06.2: this screen
          already requires `erp:settings:write`, which is exactly what the route
          checks. */}
      <JobRunner
        jobs={JOBS}
        errors={actionErrors(t)}
        s={{
          title: t("erp.jobs.title"),
          hint: t("erp.jobs.hint"),
          runNow: t("erp.jobs.runNow"),
          running: t("common.saving"),
          labels: Object.fromEntries(JOBS.map((j) => [j, t(`erp.jobs.name.${j}`)])),
        }}
      />
      </PageBody>
    </ConsoleShell>
  );
}
