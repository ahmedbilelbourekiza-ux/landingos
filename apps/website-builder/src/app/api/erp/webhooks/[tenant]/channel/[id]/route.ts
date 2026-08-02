import { channelWebhook } from "@/lib/erp/webhook-route";

export const dynamic = "force-dynamic";

/** A placed order arriving from an external storefront. */
export const POST = channelWebhook("order");
