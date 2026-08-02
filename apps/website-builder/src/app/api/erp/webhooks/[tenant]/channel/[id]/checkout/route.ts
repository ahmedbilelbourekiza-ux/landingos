import { channelWebhook } from "@/lib/erp/webhook-route";

export const dynamic = "force-dynamic";

/**
 * A started-but-unfinished checkout.
 *
 * Lands as an order marked `abandoned` — a real lead worth calling, kept out of
 * the confirmation queue so it is not counted as a sale nobody made.
 */
export const POST = channelWebhook("checkout");
