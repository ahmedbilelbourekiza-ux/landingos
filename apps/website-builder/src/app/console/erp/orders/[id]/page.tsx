import Link from "next/link";
import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { ConsoleShell } from "@/components/console/console-shell";
import { StatusPill } from "@/components/console/data-table";
import {
  CallPanel,
  NotePanel,
  ClassifyPanel,
  type OrderWriteStrings,
} from "@/components/console/erp/order-write";
import { mayTouchOrder, seesWholeBook } from "@/lib/erp/scope";
import { CALL_RESULTS, NOTE_TYPES } from "@/lib/erp/orders";

export const dynamic = "force-dynamic";

/* =============================================================================
 * One order — the screen an agent works in.
 *
 * THE OWNERSHIP CHECK IS HERE TOO, and that is not belt-and-braces. A screen
 * is a read, and reading another agent's order is the privacy half of the
 * defect `hardening.test.js §3` was written for. It uses `mayTouchOrder`, the
 * same function the API guard uses, so the two cannot answer differently.
 *
 * 404, not 403: confirming the order exists and belongs to a colleague is
 * itself information, and it is the same answer the platform gives for another
 * tenant's row.
 *
 * The call history is attached HERE and only here. The list carries a count,
 * because joining history per row is what made it quadratic.
 *
 * PHASE 6.3 — THE WRITE CONTROLS.
 *
 * D-06.2: a control is rendered only where the API would accept it. The write
 * routes require `erp:orders:write`, which an agent holds by explicit grant and
 * a plain MEMBER or VIEWER does not — and both of those can READ this page,
 * through the `*:*:read` role glob. So the panels are gated on the permission
 * itself, resolved with `can()`, the same function `tenantRoute` calls. A button
 * that 403s is worse than no button.
 *
 * The vocabularies and every label are resolved here and passed down, so the
 * client components hold no copy of either.
 * ========================================================================== */

const ATTEMPT_SLOTS = 9;

/** `client_called_back` -> `clientCalledBack`, the shape of an i18n key. */
const camel = (value: string) => value.replace(/_(.)/g, (_, c: string) => c.toUpperCase());

export default async function ErpOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, locale: raw, t } = await requireProduct("erp", `/console/erp/orders/${id}`);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const data = await withTenant(session.auth!.tenantId, async (db) => {
    const order = await db.fulfillmentOrder.findUnique({
      where: { id },
      select: {
        id: true, reference: true, client: true, phone: true,
        wilaya: true, commune: true, city: true,
        product: true, productVariant: true, quantity: true,
        price: true, status: true, classification: true,
        agentUserId: true, followupUserId: true,
        note: true, managerNote: true, source: true,
        deliveryStatus: true, deliveryOutcome: true, deliveryOutcomeAt: true,
        trackingNumber: true, createdAt: true,
        // Phase 6.3: whether a call is running is the server's fact, and the
        // panel renders it rather than starting a timer of its own.
        pendingCallStart: true,
      },
    });
    if (!order) return null;

    const calls = await db.orderCall.findMany({
      where: { orderId: id },
      orderBy: [{ time: "asc" }, { id: "asc" }],
      select: {
        id: true, time: true, callStartTime: true, duration: true,
        suspicious: true, result: true, note: true, noteType: true,
      },
    });

    const shipment = await db.shipment.findFirst({
      where: { orderId: id },
      select: {
        id: true, trackingNumber: true, crmStatus: true,
        carrier: { select: { name: true } },
        events: {
          orderBy: [{ eventTime: "asc" }, { id: "asc" }],
          select: { id: true, eventTime: true, originalStatus: true, crmStatus: true },
        },
      },
    });

    return { order, calls, shipment };
  });

  if (!data || !mayTouchOrder(session, data.order)) notFound();

  const { order, calls, shipment } = data;
  const currency = session.tenant!.currency;
  const tone = resolveStatus("confirmation", order.status ?? "");
  const attempts = calls.filter((c) => c.result);

  // The permission the write routes check, checked by the same function they
  // check it with. Reading this page needs `erp:orders:read`, which every
  // member holds by role glob; changing it needs a grant.
  const mayWrite = can(session.auth!, "erp:orders:write");

  const writeStrings: OrderWriteStrings = {
    saving: t("common.saving"),
    callPanel: t("erp.write.callPanel"),
    startCall: t("erp.write.startCall"),
    callRunning: t("erp.write.callRunning"),
    logResult: t("erp.write.logResult"),
    callNote: t("erp.write.callNote"),
    noStartHint: t("erp.write.noStartHint"),
    notePanel: t("erp.write.notePanel"),
    noteKind: t("erp.write.noteKind"),
    noteDetail: t("erp.write.noteDetail"),
    noteHint: t("erp.write.noteHint"),
    addNote: t("erp.write.addNote"),
    classifyPanel: t("erp.write.classifyPanel"),
    classifyHint: t("erp.write.classifyHint"),
    markFake: t("erp.write.markFake"),
    clearFake: t("erp.write.clearFake"),
    fakeReason: t("erp.write.fakeReason"),
    fakeResponsible: t("erp.write.fakeResponsible"),
  };

  // Straight from the module the routes validate against. `pending` is
  // deliberately absent: it is an order STATUS, not a call result, and offering
  // it would be a button the API answers 422 to.
  const results = CALL_RESULTS.map((value) => {
    const d = resolveStatus("confirmation", value);
    return { value, label: t(d.labelKey), vars: toneVars(d.tone) };
  });
  const noteTypes = NOTE_TYPES.map((value) => ({
    value,
    label: t(`erp.noteType.${camel(value)}`),
  }));

  const errors = actionErrors(t);

  return (
    <ConsoleShell session={session} productId="erp">
      <Link
        href="/console/erp/orders"
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        ← {t("erp.order.backToList")}
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          {t("erp.order.title")}{" "}
          <span className="font-mono text-base" dir="ltr">
            {order.reference ?? ""}
          </span>
        </h1>
        <StatusPill
          status={order.status ?? "unknown"}
          label={t(tone.labelKey)}
          vars={toneVars(tone.tone)}
        />
        {order.classification === "fake" && (
          <span
            data-testid="order-fake"
            className="rounded-full border px-2 py-0.5 text-xs"
            style={toneVars("danger")}
          >
            {t("erp.order.fake")}
          </span>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section
          className="rounded-lg border border-border p-4 lg:col-span-1"
          data-testid="order-customer"
        >
          <h2 className="text-sm font-medium">{t("erp.order.customerCard")}</h2>
          <p className="mt-2 font-medium">{order.client || "—"}</p>
          <p className="font-mono text-sm text-muted-foreground" dir="ltr">
            {order.phone}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {[order.wilaya, order.commune, order.city].filter(Boolean).join(" · ") || "—"}
          </p>
          {order.note && (
            <p className="mt-3 text-sm">
              <span className="text-muted-foreground">{t("erp.order.note")}: </span>
              {order.note}
            </p>
          )}
          {/* Manager-only, on the screen as well as in the API. Rendering it
              for an agent would leak through the page what the write path
              already refuses. */}
          {seesWholeBook(session) && order.managerNote && (
            <p className="mt-2 text-sm" data-testid="order-manager-note">
              <span className="text-muted-foreground">{t("erp.order.managerNote")}: </span>
              {order.managerNote}
            </p>
          )}
        </section>

        <section
          className="rounded-lg border border-border p-4 lg:col-span-2"
          data-testid="order-summary"
        >
          <h2 className="text-sm font-medium">{t("erp.orders.product")}</h2>
          <p className="mt-2">
            {order.product || "—"}
            {order.productVariant ? ` · ${order.productVariant}` : ""}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("erp.orders.quantity")}</dt>
              <dd className="tabular-nums" dir="ltr">{order.quantity ?? 1}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("erp.orders.total")}</dt>
              <dd className="tabular-nums" dir="ltr">
                {formatMoney(order.price?.toString() ?? "0", locale, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("erp.orders.placed")}</dt>
              <dd>{formatDate(order.createdAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("erp.orders.source")}</dt>
              <dd className="text-muted-foreground">{order.source || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("erp.orders.agent")}</dt>
              <dd className="text-muted-foreground">
                {order.agentUserId ? order.agentUserId : t("erp.orders.unassigned")}
              </dd>
            </div>
            {order.deliveryOutcome && (
              <div data-testid="order-outcome">
                <dt className="text-muted-foreground">{t("erp.order.outcome")}</dt>
                <dd>
                  {t(resolveStatus("delivery", order.deliveryOutcome).labelKey)}
                  {order.deliveryOutcomeAt && (
                    <span className="block text-xs text-muted-foreground">
                      {t("erp.order.settledAt")} {formatDate(order.deliveryOutcomeAt, locale)}
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      {mayWrite ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3" data-testid="erp-order-write">
          <div className="lg:col-span-2">
            <CallPanel
              orderId={order.id}
              errors={errors}
              s={writeStrings}
              results={results}
              runningSince={
                order.pendingCallStart
                  ? formatDate(order.pendingCallStart, locale, { timeStyle: "short" })
                  : null
              }
            />
          </div>
          <div className="space-y-4">
            <NotePanel orderId={order.id} errors={errors} s={writeStrings} noteTypes={noteTypes} />
            <ClassifyPanel
              orderId={order.id}
              errors={errors}
              s={writeStrings}
              isFake={order.classification === "fake"}
            />
          </div>
        </div>
      ) : (
        // Absent, and SAID to be absent. A reader who can see the order but not
        // work it should learn that from the page rather than from a button
        // that answers 403.
        <p
          data-testid="erp-order-readonly"
          className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
        >
          {t("erp.write.readOnly")}
        </p>
      )}

      <section className="mt-4 rounded-lg border border-border p-4" data-testid="order-attempts">
        <h2 className="text-sm font-medium">
          {t("erp.order.attempts")}{" "}
          <span className="text-muted-foreground">
            {Math.max(0, ATTEMPT_SLOTS - attempts.length)} {t("erp.order.attemptsLeft")}
          </span>
        </h2>
        {/* Nine slots, always. Three calls a day for three days is the
            escalation rule, and a grid that grows with the data would hide the
            remaining attempts — which is the half an agent needs. */}
        <ol className="mt-3 flex flex-wrap gap-2" dir="ltr">
          {Array.from({ length: ATTEMPT_SLOTS }, (_, i) => {
            const call = attempts[i];
            const slotTone = call ? resolveStatus("confirmation", call.result ?? "").tone : "neutral";
            return (
              <li
                key={i}
                data-slot={i + 1}
                data-used={call ? "true" : "false"}
                className="flex h-8 w-8 items-center justify-center rounded-md border text-xs tabular-nums"
                style={call ? toneVars(slotTone) : undefined}
              >
                {i + 1}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="mt-4 rounded-lg border border-border p-4" data-testid="order-calls">
        <h2 className="text-sm font-medium">{t("erp.order.history")}</h2>
        {calls.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("erp.order.noCalls")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {calls.map((call) => (
              <li
                key={String(call.id)}
                data-call-id={String(call.id)}
                className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm first:border-0 first:pt-0"
              >
                <span className="text-muted-foreground">
                  {call.time ? formatDate(call.time, locale) : "—"}
                </span>
                {call.result ? (
                  <StatusPill
                    status={call.result}
                    label={t(resolveStatus("confirmation", call.result).labelKey)}
                    vars={toneVars(resolveStatus("confirmation", call.result).tone)}
                  />
                ) : (
                  <span className="text-muted-foreground">{call.noteType}</span>
                )}
                {call.duration !== null && (
                  <span className="tabular-nums text-muted-foreground" dir="ltr">
                    {call.duration}
                    {t("erp.order.seconds")}
                  </span>
                )}
                {/* The flag a manager reviews. `suspicious` is nullable — null
                    means "not evaluated", which is what a note is — so this
                    tests for TRUE rather than truthiness. */}
                {call.suspicious === true && (
                  <span
                    data-testid="call-suspicious"
                    className="rounded-full border px-2 py-0.5 text-xs"
                    style={toneVars("danger")}
                  >
                    {call.callStartTime ? t("erp.order.suspicious") : t("erp.order.noStart")}
                  </span>
                )}
                {call.note && <span className="text-muted-foreground">{call.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-border p-4" data-testid="order-shipment">
        <h2 className="text-sm font-medium">{t("erp.order.shipment")}</h2>
        {!shipment ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("erp.order.noShipment")}</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">{t("erp.order.tracking")}</dt>
                <dd className="font-mono" dir="ltr">{shipment.trackingNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("erp.order.carrier")}</dt>
                <dd>{shipment.carrier?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("erp.orders.delivery")}</dt>
                <dd>{t(resolveStatus("delivery", shipment.crmStatus ?? "").labelKey)}</dd>
              </div>
            </dl>
            <h3 className="mt-4 text-xs font-medium text-muted-foreground">
              {t("erp.order.timeline")}
            </h3>
            <ol className="mt-2 space-y-1 text-sm">
              {shipment.events.map((event) => (
                <li key={String(event.id)} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">
                    {event.eventTime ? formatDate(event.eventTime, locale) : "—"}
                  </span>
                  <span>{t(resolveStatus("delivery", event.crmStatus ?? "").labelKey)}</span>
                  {/* The carrier's own wording, kept alongside the mapped
                      status so nothing it said is lost in translation. */}
                  <span className="text-xs text-muted-foreground">{event.originalStatus}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </ConsoleShell>
  );
}
