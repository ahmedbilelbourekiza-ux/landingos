import { z } from "zod";

import { tenantRoute, apiOk, apiError, pagination } from "@/lib/api/route";
import { scopedWhere, seesWholeBook } from "@/lib/erp/scope";
import { orderFilters, orderSort, ORDER_LIST_SELECT, createOrder, ORDER_STATUSES } from "@/lib/erp/orders";
import { autoAssignOnCreate } from "@/lib/erp/assign";
import { normalizePhone } from "@/lib/erp/phone";
import { toJson, toDecimal } from "@/lib/erp/serialize";

export const dynamic = "force-dynamic";

/* =============================================================================
 * The order book.
 *
 * Two scopes apply to every read here and they are not the same thing:
 *
 *   TENANT — applied by the binding, enforced by row-level security. Nothing
 *   in this file mentions it, and nothing in this file may.
 *
 *   RECORD — the ERP's own rule, inside the company: a confirmation agent works
 *   their own queue. Applied via scopedWhere() so it lands INSIDE the query,
 *   because filtering a page afterwards returns short pages and an unscoped
 *   total that tells an agent how much work their colleagues have.
 * ========================================================================== */

export const GET = tenantRoute("erp:orders:read", async ({ db, session, searchParams }) => {
  const { skip, take, page, pageSize } = pagination(searchParams);
  const where = scopedWhere(session, orderFilters(searchParams));

  const [items, total] = await Promise.all([
    db.fulfillmentOrder.findMany({
      where,
      orderBy: orderSort(searchParams.get("sort"), searchParams.get("dir")),
      skip,
      take,
      select: ORDER_LIST_SELECT,
    }),
    db.fulfillmentOrder.count({ where }),
  ]);

  return apiOk({
    items: items.map((o) => {
      const { _count, ...rest } = o;
      // callCount, not the calls themselves. Joining the history per row is
      // what made this endpoint quadratic; the list renders only the number.
      return { ...(toJson(rest) as object), callCount: _count.calls };
    }),
    page,
    pageSize,
    total,
  });
});

const CreateOrder = z.object({
  client: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  product: z.string().trim().max(300).optional(),
  productVariant: z.string().trim().max(200).optional(),
  quantity: z.coerce.number().int().min(1).max(10_000).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  wilaya: z.string().trim().max(120).optional(),
  commune: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  carrierCode: z.string().trim().max(60).optional(),
  deliveryMethod: z.string().trim().max(60).optional(),
  note: z.string().trim().max(2000).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  // Assignment at creation is a manager action, checked below rather than by
  // the schema — the schema cannot see who is asking.
  agentUserId: z.string().trim().max(64).optional(),
});

export const POST = tenantRoute("erp:orders:write", async ({ db, req, session, searchParams }) => {
  void searchParams;
  const parsed = CreateOrder.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const input = parsed.data;

  // The ERP refused an order with neither a name nor a number, and it is right
  // to: an order nobody can be called about cannot be confirmed, and it would
  // sit in the queue forever being counted as work.
  if (!input.client && !input.phone) {
    return apiError(422, "INVALID_INPUT", "An order needs a customer name or a phone number.");
  }

  if (input.agentUserId && !seesWholeBook(session)) {
    return apiError(403, "FORBIDDEN_FIELD", "Only a manager can assign an order.");
  }

  const price = toDecimal(input.price);
  if (input.price !== undefined && price === null) {
    return apiError(422, "INVALID_INPUT", '"price" must be a number.');
  }

  const tenantId = session.auth!.tenantId;
  // Normalised at the edge, which is what the ERP did and what its tests
  // assert: a number entered as +213 555 12 34 56 is STORED as 0555123456, so
  // the order book holds one canonical form rather than however each agent,
  // storefront and spreadsheet happened to type it. `phoneNormalized` carries
  // the same value and is the indexed key Client joins on — written from the
  // same function, so the two cannot disagree. The ERP kept them in step by
  // coincidence.
  const phone = normalizePhone(input.phone);

  // An explicit agent wins; otherwise the roster decides, if the tenant has
  // asked it to. That order is the ERP's `resolveAgent` — a manager naming
  // somebody is a decision, and the automation exists to fill the gap when
  // nobody has made one.
  const agentUserId =
    input.agentUserId ?? (await autoAssignOnCreate(db, tenantId));

  const id = await createOrder(db, tenantId, {
    tenantId,
    client: input.client ?? "",
    phone,
    phoneNormalized: phone,
    product: input.product ?? "",
    productVariant: input.productVariant ?? "",
    quantity: input.quantity ?? 1,
    price,
    wilaya: input.wilaya ?? "",
    commune: input.commune ?? "",
    city: input.city ?? "",
    carrierCode: input.carrierCode ?? "",
    deliveryMethod: input.deliveryMethod ?? "",
    note: input.note ?? "",
    status: input.status ?? "pending",
    agentUserId,
    // Set by the system, never by a caller: an order claiming to have arrived
    // from Shopify when it did not corrupts every channel report downstream.
    source: "manual",
  });

  const created = await db.fulfillmentOrder.findUnique({
    where: { id },
    select: ORDER_LIST_SELECT,
  });
  const { _count, ...rest } = created!;
  return apiOk({ ...(toJson(rest) as object), callCount: _count.calls }, { status: 201 });
});
