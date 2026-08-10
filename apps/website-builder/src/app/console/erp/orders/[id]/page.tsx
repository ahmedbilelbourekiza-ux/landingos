import Link from "next/link";
import { notFound } from "next/navigation";

import { withTenant } from "@landingos/db";
import { can } from "@landingos/auth";
import { resolveStatus, toneVars } from "@landingos/ui";
import { formatMoney, formatDate, isLocale, DEFAULT_LOCALE } from "@landingos/i18n";

import { requireProduct } from "@/lib/console/product-page";
import { actionErrors } from "@/lib/console/action-errors";
import { PageHeader, PageBody } from "@/components/console/ui/primitives";
import { StatusPill } from "@/components/console/data-table";
import {
  CallPanel,
  NotePanel,
  ClassifyPanel,
  EditPanel,
  ReassignPanel,
  ParcelPanel,
  type OrderWriteStrings,
} from "@/components/console/erp/order-write";
import { editFingerprint, type EditField } from "@/components/console/edit-field";
import { ProductThumb } from "@/components/console/erp/product-thumb";
import { StockChip } from "@/components/console/erp/stock-chip";
import { stockLabels } from "@/lib/console/erp-strings";
import { mayTouchOrder, seesWholeBook } from "@/lib/erp/scope";
import { resolveOrderProduct } from "@/lib/erp/order-product";
import { CALL_RESULTS, NOTE_TYPES, ORDER_STATUSES } from "@/lib/erp/orders";

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
        // AUDIT.7. When the CUSTOMER ordered, which is not when we heard
        // whenever a platform replays a backlog. Rendered only when it differs.
        externalOrderAt: true,
        deliveryStatus: true, deliveryOutcome: true, deliveryOutcomeAt: true,
        trackingNumber: true, createdAt: true,
        // Phase 6.3: whether a call is running is the server's fact, and the
        // panel renders it rather than starting a timer of its own.
        pendingCallStart: true,
        // 6.3b: the rest of what the edit form can write.
        shippingNote: true, marketer: true, brand: true, expressDelivery: true,
        // LP.9: written since Phase 5, read by nothing until now.
        fakeReason: true, fakeResponsible: true,
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

    // Only for a caller who already sees the whole book. That is the same
    // predicate `buildPatch` uses to decide whether reassignment is a 403, so
    // the picker exists exactly where the write is allowed — and somebody who
    // sees every order's `agentUserId` learns nothing new from a name beside it.
    const members = seesWholeBook(session)
      ? await db.membership.findMany({
          orderBy: { createdAt: "asc" },
          // Named fields, not `include: { user: true }`. SEC-02 arrived the
          // first time by including a record that carried a password hash.
          select: { userId: true, user: { select: { name: true, email: true } } },
        })
      : [];

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

    /* N12. The platform audit trail for THIS order, read only for somebody
       holding `erp:audit:read`. Seeing an order is doing your job; seeing who
       else touched it is supervision — the same distinction the analytics
       league table draws. `null` rather than `[]` when withheld, so the section
       is absent rather than rendering an empty list that reads as "nobody
       touched this". */
    const audit = can(session.auth!, "erp:audit:read")
      ? await db.auditEvent.findMany({
          where: { product: "erp", entity: "order", entityId: id },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, userId: true, action: true, createdAt: true },
        })
      : null;

    /* PM.2 / PM.5 — the catalogue row this order is about.
       The legacy shows a photograph on every order and the platform ported the
       column and none of the readers. The same lookup carries the level of the
       exact variant somebody is about to confirm, which is the fact this screen
       has never said and the one that decides whether confirming is a promise
       anybody can keep. */
    const catalog = await resolveOrderProduct(db, order);

    return { order, calls, shipment, members, audit, catalog };
  });

  if (!data || !mayTouchOrder(session, data.order)) notFound();

  const { order, calls, shipment, members, audit, catalog } = data;
  const actorNames = new Map(members.map((m) => [m.userId, m.user.name || m.user.email]));
  const currency = session.tenant!.currency;
  const tone = resolveStatus("confirmation", order.status ?? "");
  const attempts = calls.filter((c) => c.result);

  // The permission the write routes check, checked by the same function they
  // check it with. Reading this page needs `erp:orders:read`, which every
  // member holds by role glob; changing it needs a grant.
  const mayWrite = can(session.auth!, "erp:orders:write");
  // A different permission, checked because the shipment routes check it. A
  // confirmation agent logs calls and does not book parcels.
  const mayShip = can(session.auth!, "erp:shipments:write");

  const managesBook = seesWholeBook(session);

  const writeStrings: OrderWriteStrings = {
    saving: t("common.saving"),
    save: t("common.save"),
    editPanel: t("erp.write.editPanel"),
    editManagerFields: t("erp.write.editManagerFields"),
    reassignPanel: t("erp.write.reassignPanel"),
    assignedAgent: t("erp.write.assignedAgent"),
    followupAgent: t("erp.write.followupAgent"),
    unassigned: t("erp.write.unassigned"),
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
    parcelPanel: t("erp.write.parcelPanel"),
    bookParcel: t("erp.write.bookParcel"),
    refreshParcel: t("erp.write.refreshParcel"),
    parcelHint: t("erp.write.parcelHint"),
    refreshHint: t("erp.write.refreshHint"),
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

  const statuses = ORDER_STATUSES.map((value) => ({
    value,
    label: t(resolveStatus("confirmation", value).labelKey),
  }));

  /* The edit form.
   *
   * The list mirrors AGENT_WRITABLE and MANAGER_WRITABLE in `lib/erp/orders.ts`
   * — nothing here is offered that `buildPatch` would drop, and every
   * manager-only field is withheld from an agent rather than dropped silently
   * after they typed into it.
   *
   * Three writable fields carry no control on purpose. `deliveryMethod` is
   * `'COD'` everywhere in the ERP and has no vocabulary, so a free-text box
   * would invite writing a value nothing downstream understands. `lineItems` is
   * a JSON document. `unitPrice`/`subtotal`/`discount`/`shippingCost` are the
   * storefront's own arithmetic; offering them beside `price` would let the two
   * disagree with nothing to reconcile them. */
  const text = (name: string, label: string, value: unknown, manager = false): EditField => ({
    name, label, value: value == null ? "" : String(value), kind: "text", manager,
  });

  const editFields: EditField[] = [
    text("client", t("erp.orders.customer"), order.client),
    text("phone", t("erp.clients.phone"), order.phone),
    text("wilaya", t("erp.orders.wilaya"), order.wilaya),
    text("commune", t("erp.orders.commune"), order.commune),
    text("city", t("erp.orders.city"), order.city),
    text("product", t("erp.orders.product"), order.product),
    text("productVariant", t("erp.orders.variant"), order.productVariant),
    {
      name: "quantity", label: t("erp.orders.quantity"),
      value: String(order.quantity ?? 1), kind: "number",
    },
    {
      name: "status", label: t("erp.orders.status"),
      value: order.status ?? "", kind: "select", options: statuses,
    },
    {
      name: "expressDelivery", label: t("erp.orders.express"),
      value: String(Boolean(order.expressDelivery)), kind: "checkbox",
    },
    { name: "note", label: t("erp.order.note"), value: order.note ?? "", kind: "textarea" },
    {
      name: "shippingNote", label: t("erp.order.shippingNote"),
      value: order.shippingNote ?? "", kind: "textarea",
    },
    ...(managesBook
      ? ([
          {
            // Money as text with a decimal keypad, never `type="number"`: a
            // number input hands back a JS float and this column is Decimal
            // precisely so money never touches binary floating point (M-06).
            name: "price", label: t("erp.orders.total"),
            value: order.price?.toString() ?? "", kind: "money", manager: true,
          },
          text("marketer", t("erp.orders.marketer"), order.marketer, true),
          text("brand", t("erp.orders.brand"), order.brand, true),
          {
            name: "managerNote", label: t("erp.order.managerNote"),
            value: order.managerNote ?? "", kind: "textarea", manager: true,
          },
        ] satisfies EditField[])
      : []),
  ];

  const memberOptions = members.map((m) => ({
    value: m.userId,
    label: m.user.name || m.user.email,
  }));

  return (
    <>
      <PageBody>
      {/* UI.22 — a real breadcrumb, replacing three different hand-written back
          links: this screen's `← Back to list`, the client detail's own, and the
          product detail's complete absence. The last crumb is where you are and
          carries no href — a link to the page you are on is a control that does
          nothing. */}
      <PageHeader
        breadcrumb={[
          { label: t("erp.orders.title"), href: "/console/erp/orders" },
          { label: order.reference ?? t("erp.order.title") },
        ]}
        title={
          <>
            {t("erp.order.title")}{" "}
            <span className="font-mono text-base" dir="ltr">
              {order.reference ?? ""}
            </span>
          </>
        }
        meta={
          <>
            <StatusPill
              status={order.status ?? "unknown"}
              label={t(tone.labelKey)}
              vars={toneVars(tone.tone)}
            />
            {order.classification === "fake" && (
              <>
                <span
                  data-testid="order-fake"
                  className="rounded-full border px-2 py-0.5 text-xs font-medium"
                  style={toneVars("danger")}
                >
                  {t("erp.order.fake")}
                </span>
                {/* LP.9 — WHY, and WHO SAYS. `fakeReason` and `fakeResponsible`
                    have been written by `POST /orders/[id]/classify` since Phase
                    5 and read back by nothing: the pill said an order was fake
                    and no screen said why. Marking an order fake removes it from
                    the confirmed count and names a colleague, so this is the
                    part somebody disputes. */}
                {(order.fakeReason || order.fakeResponsible) && (
                  <span data-testid="order-fake-reason" className="text-xs text-muted-foreground">
                    {[order.fakeReason, order.fakeResponsible].filter(Boolean).join(" · ")}
                  </span>
                )}
              </>
            )}
          </>
        }
      />

      {/* PM.9 — the summary that scrolls WITH the reader. Eleven sections and
          ~2,600px of page put the status and the primary action a screen apart;
          this strip keeps the four facts an operator re-checks mid-call —
          who, number, value, state — in view the whole way down, and carries
          the one jump that matters. Sticky offset written with the `_`
          separators (the Tailwind-calc rule: a bare space ends the class and
          the declaration silently emits nothing). */}
      <div
        data-testid="order-summary-strip"
        /* Sticky from `sm` up only. On a phone the strip wraps to three rows
           (~94px) and, stacked on the console header, ate 20% of a 740px
           viewport for the whole 4,000px scroll — measured in the mobile
           audit. A phone reader scrolls past it once and keeps their screen. */
        className="sm:sticky sm:top-[calc(var(--console-header-h)_+_0.5rem)] z-20 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface-raised px-4 py-2.5 shadow-e2"
      >
        <span className="font-mono text-xs font-medium text-foreground" dir="ltr">
          {order.reference ?? ""}
        </span>
        <StatusPill
          status={order.status ?? "unknown"}
          label={t(tone.labelKey)}
          vars={toneVars(tone.tone)}
        />
        <span className="min-w-0 max-w-48 truncate text-sm text-foreground">
          {order.client || "—"}
        </span>
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline" dir="ltr">
          {order.phone}
        </span>
        <span className="ms-auto text-sm font-semibold tabular-nums text-foreground" dir="ltr">
          {formatMoney(order.price?.toString() ?? "0", locale, currency)}
        </span>
        {mayWrite && (
          <a href="#erp-order-write" className="ui-btn ui-btn-primary ui-btn-sm tap">
            {t("common.actions")}
          </a>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section
          className="rounded-lg border border-border bg-surface-raised p-4 lg:col-span-1"
          data-testid="order-customer"
        >
          <h2 className="text-sm font-semibold tracking-tight">{t("erp.order.customerCard")}</h2>
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
          className="rounded-lg border border-border bg-surface-raised p-4 lg:col-span-2"
          data-testid="order-summary"
        >
          <h2 className="text-sm font-semibold tracking-tight">{t("erp.orders.product")}</h2>
          {/* PM.2 — the thing being sold, shown rather than described. PM.5 —
              and whether there is any of it left, which is the fact that
              decides whether confirming this order is a promise the warehouse
              can keep. Both come from ONE catalogue lookup, resolved the way
              `resolveProduct` resolves it (the link first, exclusively, then a
              normalised name) so the photograph cannot disagree with the
              revenue counters on the same product. */}
          <div className="mt-2 flex items-start gap-3" data-testid="order-product">
            <ProductThumb src={catalog?.image} alt="" size="md" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {catalog ? (
                  <Link
                    href={`/console/erp/products/${catalog.productId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {order.product || "—"}
                  </Link>
                ) : (
                  (order.product || "—")
                )}
                {order.productVariant ? (
                  <span className="text-muted-foreground"> · {order.productVariant}</span>
                ) : null}
              </p>
              {catalog && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StockChip
                    stock={catalog.stock}
                    threshold={catalog.threshold}
                    labels={stockLabels(t)}
                  />
                  {catalog.unknownVariant && (
                    <span className="text-2xs text-muted-foreground">
                      {t("erp.order.unknownVariant")}
                    </span>
                  )}
                </div>
              )}
              {/* Absent rather than silent. An order whose product matches no
                  catalogue row — or matches two (AUDIT.3) — moves no counters
                  and reserves no stock, and until now the only evidence was a
                  figure that never changed. */}
              {!catalog && order.product && (
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  {t("erp.order.noCatalogMatch")}
                </p>
              )}
            </div>
          </div>
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
            {/* AUDIT.7. Shown ONLY when the storefront's time differs from ours
                by more than a minute. Two dates side by side that always agree
                is a field people stop reading; the case worth seeing is the one
                where a connected store replayed a week of backlog and every
                order says it arrived today. */}
            {order.externalOrderAt
              && Math.abs(order.externalOrderAt.getTime() - order.createdAt.getTime()) > 60_000 && (
              <div data-testid="order-external-date">
                <dt className="text-muted-foreground">{t("erp.orders.orderedOnStore")}</dt>
                <dd>{formatDate(order.externalOrderAt, locale)}</dd>
              </div>
            )}
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
        // `id` + `scroll-mt`: the summary strip's Actions link lands here, and
        // without the scroll margin the target hides under the two sticky bars.
        <div
          id="erp-order-write"
          className="mt-4 grid scroll-mt-28 gap-4 lg:grid-cols-3"
          data-testid="erp-order-write"
        >
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

          <div className="lg:col-span-2">
            {/* Keyed on what the server holds, so a refresh that changed a
                value remounts the form on the server's answer — `buildPatch`
                normalises a phone number, and the box must not go on showing
                what was typed. See editFingerprint. */}
            <EditPanel
              key={editFingerprint(editFields)}
              orderId={order.id}
              errors={errors}
              s={writeStrings}
              fields={editFields}
            />
          </div>

          {/* Only where `buildPatch` would allow it. For anyone else the field
              is a loud 403 with FORBIDDEN_FIELD — deliberately loud, because
              silently dropping it would let an agent believe they had picked up
              work — and the way to keep that refusal unreachable from the
              screen is to not offer the control. */}
          {managesBook && (
            <div>
              <ReassignPanel
                key={`${order.agentUserId ?? ""}/${order.followupUserId ?? ""}`}
                orderId={order.id}
                errors={errors}
                s={writeStrings}
                members={memberOptions}
                currentAgentUserId={order.agentUserId ?? ""}
                currentFollowupUserId={order.followupUserId ?? ""}
              />
            </div>
          )}
        </div>
      ) : mayShip ? null : (
        // Absent, and SAID to be absent. A reader who can see the order but not
        // work it should learn that from the page rather than from a button
        // that answers 403. Suppressed when the parcel panel below is offered,
        // since "you cannot change this" beside a control would be wrong.
        <p
          data-testid="erp-order-readonly"
          className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
        >
          {t("erp.write.readOnly")}
        </p>
      )}

      {mayShip && (
        <div className="mt-4">
          <ParcelPanel
            orderId={order.id}
            errors={errors}
            s={writeStrings}
            hasShipment={Boolean(shipment)}
          />
        </div>
      )}

      <section className="mt-4 rounded-lg border border-border bg-surface-raised p-4" data-testid="order-attempts">
        <h2 className="text-sm font-semibold tracking-tight">
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

      <section className="mt-4 rounded-lg border border-border bg-surface-raised p-4" data-testid="order-calls">
        <h2 className="text-sm font-semibold tracking-tight">{t("erp.order.history")}</h2>
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

      {/* N12 — WHO CHANGED WHAT. The ERP opens an investigation modal per
          order; `/api/erp/audit?entity=order&entityId=…` existed and no screen
          rendered it, so the trail was reachable only by hand-typing a URL. It
          is the answer to the question that follows every disputed order: who
          moved it, when, and from what.

          Gated on `erp:audit:read` rather than on reading the order. Seeing an
          order is doing your job; seeing who else touched it is supervision, and
          the same distinction the analytics league table draws. */}
      {audit && (
        <section className="mt-4 rounded-lg border border-border bg-surface-raised p-4" data-testid="order-audit">
          <h2 className="text-sm font-semibold tracking-tight">{t("erp.order.audit")}</h2>
          {audit.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("erp.order.auditEmpty")}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {audit.map((row) => (
                <li key={row.id} data-audit-action={row.action} className="flex flex-wrap gap-2">
                  <span className="text-muted-foreground">{formatDate(row.createdAt, locale)}</span>
                  <span className="font-medium">{row.action}</span>
                  <span className="text-muted-foreground">
                    {row.userId ? (actorNames.get(row.userId) ?? row.userId) : t("erp.orders.unassigned")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-4 rounded-lg border border-border bg-surface-raised p-4" data-testid="order-shipment">
        <h2 className="text-sm font-semibold tracking-tight">{t("erp.order.shipment")}</h2>
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
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
      </PageBody>
    </>
  );
}
