import { z } from "zod";

import { tenantRoute, apiOk, apiError } from "@/lib/api/route";
import { loadOwnedOrder } from "@/lib/erp/guard";
import { addCall, NOTE_TYPES } from "@/lib/erp/orders";
import { readSettings } from "@/lib/erp/settings";

export const dynamic = "force-dynamic";

type Params = { id: string };

const AddNote = z.object({
  noteType: z.string().trim().min(1),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Record something that happened which is NOT a call outcome.
 *
 * A note lands in the same timeline as calls — it is the same event stream and
 * a manager reading the history wants both — but it carries no result and must
 * not move the status. The ERP asserted this directly, because the obvious
 * implementation reuses the call path and quietly marks an order confirmed
 * when somebody records "customer rang us".
 *
 * `suspicious` stays null for the same reason: a note was never a judged call,
 * and false would say it was assessed and found clean.
 */
export const POST = tenantRoute<Params>("erp:orders:write", async ({ db, req, session, params }) => {
  const { order, denied } = await loadOwnedOrder(db, session, params.id);
  if (denied) return denied;

  const parsed = AddNote.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError(422, "INVALID_INPUT", "A note type is required.");
  }
  const noteType = parsed.data.noteType;

  if (!NOTE_TYPES.includes(noteType as (typeof NOTE_TYPES)[number])) {
    return apiError(422, "INVALID_NOTE_TYPE", `"${noteType}" is not a note type.`, {
      valid: [...NOTE_TYPES],
    });
  }

  const settings = await readSettings(db);
  const call = await addCall(db, session.auth!.tenantId, order, {
    result: null,
    note: parsed.data.note ?? "",
    noteType,
    agentUserId: session.user.id,
    minCallSeconds: Number(settings.minCallSeconds) || 0,
  });

  return apiOk({ message: "noted", callId: call.id });
});
